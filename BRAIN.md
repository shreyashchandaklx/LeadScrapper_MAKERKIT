# BRAIN.md — Lead Scrapper PROD

> Complete codebase knowledge for AI assistants and developers.

---

## 1. Project Overview

Lead Scrapper is a **Google Maps lead generation tool** by Pixnom. It scrapes business data (name, phone, email, website, rating, reviews, etc.) from Google Maps via Apify actors, stores results in a shared cache pool, and delivers unique leads per user with a credit-based billing system.

### Two Deployment Targets

| Target | URL | Stack | Purpose |
|--------|-----|-------|---------|
| **Standalone** | leadscrapper.pixnom.com | React 19 + Vite + PHP-FPM (Nginx) | Standalone app — can run without login in pure-file-cache mode |
| **Embedded** | app.pixnom.com/home/leadscrapper/* | Next.js (Makerkit SaaS kit) | Iframe wrapper inside the Makerkit dashboard — uses Supabase auth + credits |

The standalone app detects `?embed=true` in the URL and hides its own top nav/header/footer, acting as a pure feature panel inside the Makerkit shell.

---

## 2. Tech Stack

### Frontend (Standalone)
- **React 19** (JSX, not TSX) with **Vite 8**
- **Tailwind CSS 4** + **DaisyUI 5** (browser CDN, not PostCSS build)
- **Paper Theme** (`data-theme="paper"`) — loaded via `<link>` in index.html
- **Lucide React** icons
- **jsPDF** for audit report generation
- **country-state-city** for location dropdowns
- **zipcodes** for ZIP validation
- Custom Vite plugin transforms JSX-in-JS template strings into valid JSX at build time

### Backend
- **PHP 8.x** (no framework — raw PHP files on VPS)
- **Nginx** + **PHP-FPM** (leadscrapper-vhost.conf)
- **VPS**: 74.208.208.186

### Database
- **Supabase** (PostgreSQL) — REST API via lib/supabase.php
- Key tables: leadscrapper_leads_data, user_leadscrapper_leads, user_credits, city_scrape_jobs, city_scrape_zips, city_scrape_subscribers, apify_keys, plan_credits, credit_grants, credit_revocations, leadscrapper_activity_log

### Integrations
- **Apify** — Google Maps scraper actors (up to 21 API keys with rotation)
- **Resend** — Transactional email delivery
- **YOURLS** — URL shortening
- **Stripe** — Subscription billing (via Makerkit)
- **Endorsely** — Affiliate tracking
- **Cloudflare Turnstile** — Bot protection
- **PostHog** — Product analytics, session recording, error tracking (key: `phc_zCwgYZYRbW6wgcmiRcuGrWiVgzKnDKsmyr8vMNhvQ3cP`, host: `https://us.i.posthog.com`)
- **Google Apps Script** (Code.gs) — Legacy Google Sheets backend

### Makerkit (app.pixnom.com)
- **Next.js** with Makerkit SaaS kit (`next-supabase-saas-kit-turbo-main`)
- **PM2** process manager (`pm2 restart makerkit`)
- **Supabase** for auth + billing
- **Stripe** for checkout/billing portal

---

## 3. Architecture

### Data Flow — Search

```
Browser -> LeadSearch.jsx -> leads-proxy.php (or apify-proxy.php)
  -> check Supabase cache (leadscrapper_leads_data)
  -> if miss: pick Apify key -> run actor -> store results in cache
  -> applyCreditSlice() -> deduct from user_credits via Makerkit proxy
  -> insert delivered/queued rows into user_leadscrapper_leads
  -> return leads to browser
```

### Data Flow — City-Wide Scrape

```
Browser -> city-scrape-proxy.php -> creates job in city_scrape_jobs
  -> expands city to ZIP list -> inserts into city_scrape_zips
  -> city_scrape_worker.php (CLI cron, every 1-2 min)
      -> reap_stuck_zips() -> claim_next_zip() -> scrape one ZIP via Apify
      -> finish_zip() -> update job counters
  -> leads accumulate in leadscrapper_leads_data (shared pool)
  -> user sees leads as they VIEW them (credit deducted on view, not scrape)
```

### Two-Table Design

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| leadscrapper_leads_data | **Shared scrape pool** — one row per business per search | PlaceId, SearchString, UserEmail='__cache__', all Google Maps fields |
| user_leadscrapper_leads | **Per-user state** — delivered/queued/saved/search | CustomerID, PlaceId, SearchString, Status |

Additional tables: customer_lookup (email-to-CustomerID mapping), city_scrape_jobs/zips/subscribers, apify_keys, plan_credits, credit_grants, credit_revocations.

### Credit System

- **1 credit = 1 lead**
- Credits deducted on **VIEW** (when user sees leads), not on scrape
- Credits managed by Makerkit proxy (leadscrapper-credits-proxy.php -> app.pixnom.com)
- Plan-based top-up via Stripe webhook triggers (grant_subscription_credits())
- Replace policy: plan switch or renewal **replaces** wallet (no rollover)
- Zero on cancel: wallet zeroed when subscription truly ends (status=canceled or row deleted)

### Plans (Stripe Live)

| Plan | Price | Credits |
|------|-------|---------|
| Starter | $29.99/mo | 1,000 |
| Pro | $59.99/mo | 3,500 |
| Enterprise | $99.99/mo | 10,000 |

Dev accounts (2 emails) get unlimited credits (9999) bypass.

---

## 4. File Structure

```
Lead Scrapper PROD/
├── app.jsx                    # Main SPA entry, lazy-loads 7 pages, page-based routing, PostHog reset+identify
├── index.html                 # DaisyUI 5 CDN, Paper theme, Turnstile, title, PostHog snippet
├── package.json               # Vite + React 19 + jsPDF + country-state-city + zipcodes
├── vite.config.js             # Custom JSX transform plugin, build -> dist/
├── .env.example               # RESEND_API_KEY, TURNSTILE, APIFY_KEYs, SUPABASE_URL/KEY, SERVICE_TOKENs
├── styles.css                 # DaisyUI overrides, custom scrollbar, responsive fixes
│
├── components/                # React UI components
│   ├── Sidebar.jsx            # Desktop sidebar + mobile bottom nav
│   ├── TopNavbar.jsx          # Services dropdown, credit bar, theme toggle, logout
│   ├── Dashboard.jsx          # Quick stats, recent searches, top leads, activity
│   ├── LeadSearch.jsx         # Core search UI: keyword/country/state/city/ZIP, CSV export
│   ├── LeadManager.jsx        # Kanban+table views, drag-drop status, bulk ops
│   ├── LeadDetail.jsx         # Full business detail modal
│   ├── EmailGenerator.jsx     # AI email writer (Resend API)
│   ├── ReportGenerator.jsx    # Audit report PDF generator (jsPDF)
│   ├── ReviewResponder.jsx    # Review response generator
│   ├── PostCreator.jsx        # Social media post creator
│   ├── EmailOutreach.jsx      # Bulk email campaign manager
│   ├── Settings.jsx           # User settings, API keys, preferences
│   ├── SearchableDropdown.jsx # Reusable searchable select component
│   └── ErrorBoundary.jsx      # React error boundary with retry
│
├── lib/                       # PHP backend helpers
│   ├── supabase.php           # Minimal Supabase REST client (sb_request, sb_select, etc.)
│   ├── supabase_cache.php     # SupabaseCache class: query cache, batch insert, upsert
│   ├── credits.php            # Credit deduction via Makerkit proxy, local audit
│   ├── error_logger.php       # File-based error logger (JSON lines, ERR-LS- IDs)
│   ├── activity_logger.php    # File-based activity logger (JSON lines)
│   ├── city_scrape.php        # City scrape RPCs (create job, pick ZIP, finish, etc.)
│   └── keyword_normalize.php  # Keyword normalization (lowercase + trailing 's' strip)
│
├── utils/                     # Frontend JS utilities
│   ├── errorLogger.js         # Client-side error logging (sends to error-log.php)
│   ├── activityLogger.js      # Client-side activity logging (sends to activity-log.php)
│   ├── mockData.js            # Fallback mock data for demo/offline
│   ├── emailExtractor.js      # Email extraction from text
│   ├── helpers.js             # Shared utilities (formatting, validation, etc.)
│   ├── pdfGenerator.js        # jsPDF audit report generation
│   ├── map2web.js             # Map2Web integration (build/publish via proxy)
│   └── gmbAudit.js            # Google Business Profile audit scoring engine
│
├── PHP Endpoints
│   ├── apify-proxy.php        # Core scraping proxy: key rotation, cache merge, credit deduction
│   ├── leads-proxy.php        # Lead CRUD (load/save/update/delete) via two-table model
│   ├── extract-email.php      # Email extraction from website URLs
│   ├── sheets-proxy.php       # Google Sheets integration
│   ├── shorten-url.php        # YOURLS URL shortening
│   ├── send-otp.php           # OTP email sending via Resend
│   ├── map2web-proxy.php      # Reverse proxy to app.pixnom.com Map2Web API
│   ├── leadscrapper-credits-proxy.php # Credit balance/deduction proxy to Makerkit
│   ├── error-log.php          # Error logging endpoint
│   ├── activity-log.php       # Activity logging endpoint
│   ├── activity-report.php    # Activity report endpoint
│   ├── city-scrape-proxy.php  # City scrape job API (create/status/cancel)
│   ├── city_scrape_worker.php # CLI cron worker: background ZIP scraping
│   ├── error_notify_cron.php  # 15-min cron: error digest email via Resend
│   ├── turnstile-key.php      # Turnstile site key endpoint
│   ├── test_credits.php       # Debug: test credit operations
│   ├── clean.php              # Utility/maintenance script
│   ├── debug.php              # Debug utilities
│   └── debug-cache.php        # Debug: cache inspection
│
├── sql/                       # SQL scripts (one-time migrations)
│   ├── 01_credits_migration.sql
│   ├── 02_extras_queue_migration.sql
│   └── 03_deduplicate_leads.sql
│
├── migrations/                # Ordered SQL migrations (Supabase SQL editor)
│   ├── 001_two_table_redesign.sql
│   ├── 001b_add_assign_customer_rpc.sql
│   ├── 002_drop_old_tables.sql
│   ├── 003_consolidate_to_two_tables.sql
│   ├── TWO_TABLE_MIGRATION.md
│   ├── 20260522000000_credit_bridge.sql
│   ├── 20260522010000_credit_bridge_fix_trigger_target.sql
│   ├── 20260522020000_credit_topup_upsert.sql
│   ├── 20260523180000_credit_bridge_replace_policy.sql
│   ├── 20260523200000_zero_credits_on_cancel.sql
│   ├── 20260524000000_zero_credits_on_cancel_immediate.sql
│   ├── 20260524010000_revert_to_cancel_at_period_end.sql
│   ├── 20260524020000_zero_credits_on_delete.sql
│   ├── 20260525000000_plan_credits_live_products.sql
│   ├── 20260613000000_city_scrape.sql
│   └── 20260616000000_city_scrape_target.sql
│
├── makerkit-leadscrapper/     # Makerkit dashboard pages (Next.js)
│   ├── DEPLOY.md
│   ├── layout.tsx             # Passthrough layout
│   ├── page.tsx               # Redirect -> /home/leadscrapper/find-leads
│   ├── _components/
│   │   ├── LeadscrapperFrame.tsx       # Server component: builds iframe URL with email
│   │   └── LeadscrapperFrameClient.tsx # Client component: iframe + postMessage sync
│   ├── dashboard/page.tsx     # page=dashboard
│   ├── find-leads/page.tsx    # Default view (no page slug)
│   ├── lead-manager/page.tsx  # page=leads
│   ├── ai-email-writer/page.tsx # page=email-gen
│   ├── pdf-reports/page.tsx   # page=reports
│   ├── review-responder/page.tsx # page=review
│   ├── post-creator/page.tsx  # page=posts
│   ├── email-outreach/page.tsx # page=outreach
│   └── settings/page.tsx      # page=settings
│
├── makerkit-api-credits/      # Makerkit API routes (Next.js)
│   ├── get/route.ts           # GET /api/supabase/credits/get
│   └── deduct-leads/route.ts  # POST /api/supabase/credits/deduct-leads
│
├── _makerkit-staging/         # Staging files for Makerkit updates
│   ├── services-dropdown.tsx  # Services menu (Map2Web, LeadScrapper, Uptime)
│   ├── need-help-dropdown.tsx # Contact/phone dropdown
│   ├── leadscrapper-top-bar.tsx # Top bar with credit balance + Upgrade button
│   ├── layout.tsx             # Makerkit layout wrapper
│   └── endorsely-step3/       # Endorsely affiliate tracking integration
│       ├── DEPLOY.md
│       ├── create-stripe-checkout.ts
│       ├── personal-account-checkout.schema.ts
│       ├── personal-account-checkout-form.tsx
│       └── user-billing.service.ts
│
├── _lib.ts                    # Shared helpers for Makerkit credit API
├── Code.gs                    # Legacy Google Apps Script backend
└── BRAIN.md                   # This file
```

> NOTE: PostHog identity on the embedded tab is wired in `app.jsx` (standalone) and the Makerkit
> root provider — there are **no** `posthog-provider.tsx` / `posthog-identifier.tsx` files inside
> `makerkit-leadscrapper/_components/` (that folder holds only the two `LeadscrapperFrame*` files).

---

## 5. Key Behaviors

### Apify Key Rotation
- Up to 21 API keys loaded from env vars (APIFY_KEY_1 through APIFY_KEY_21). `.env.example` documents the first 10; `apify-proxy.php` reads up to 21.
- Round-robin selection with cooldown on 402/403/429 responses
- Daily auto-reset of counters
- apify_keys table tracks per-key state (runs_today, cooldown_until, is_suspended)
- pick_apify_key() RPC selects least-used healthy key

### Cache and Deduplication
- **Shared pool**: All users contribute to the same cache in leadscrapper_leads_data (rows with UserEmail='__cache__')
- **Per-user dedup**: user_leadscrapper_leads tracks which PlaceIds each user has already received
- **Keyword normalization**: lowercase + trim + strip single trailing 's' (so "Plumbers" and "Plumber" share cache)
- **Cache key format**: `keyword|city,state|country` (e.g., `plumber|denver,co|us`)

### Credit Deduction Flow
1. User searches -> applyCreditSlice() in apify-proxy.php
2. Fetches balance from Makerkit: GET /api/supabase/credits/get?email=...
3. For each lead not already delivered to this user: add to extras queue
4. Charge = count of new leads × 1 credit each
5. POST to Makerkit: /api/supabase/credits/deduct-leads with {email, leadCount}
6. Makerkit checks balance, deducts, returns success/failure
7. On success: mark leads as delivered in user_leadscrapper_leads

### City-Wide Scraping
- User initiates via city-scrape-proxy.php -> creates job + ZIP queue
- Background worker (city_scrape_worker.php) runs via cron every 1-2 min
- Worker: reap stuck -> claim next ZIP -> scrape via Apify -> finish ZIP
- Worker runs on ~50s budget per invocation (cron ensures continuity)
- **Target-based stopping**: Each job has target_leads (default 100). Worker stops when pool reaches target. Auto-resumes if user needs more.
- Leads accumulate in shared pool; users charged on VIEW, not scrape

### Embed Mode
- `?embed=true` in URL -> standalone app hides top nav/header/footer
- `?page=<slug>` -> routes to specific view on load
- Makerkit iframe posts `leadscrapper:setPage` message to sync SPA state
- Email passed via `?email=` query param (from Makerkit auth)

### PostHog Analytics
- **Key**: `phc_zCwgYZYRbW6wgcmiRcuGrWiVgzKnDKsmyr8vMNhvQ3cP`
- **Host**: `https://us.i.posthog.com` (US Cloud)
- **Snippet**: In `index.html` `<head>` with autocapture, session recording, error capture:
  ```html
  <script>
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.",".")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    posthog.init('phc_zCwgYZYRbW6wgcmiRcuGrWiVgzKnDKsmyr8vMNhvQ3cP', {
      api_host: 'https://us.i.posthog.com',
      autocapture: true,
      capture_pageview: false,
      persistence: 'localStorage+cookie',
      session_recording: { maskTextSelector: '.sensitive', maskTextAttributes: ['placeholder', 'value'] }
    });
  </script>
  ```
- **Identity flow**:
  - On page load: `posthog.reset()` + `posthog.identify(email)` (email from localStorage `userEmail`)
  - On OTP login: same flow in `app.jsx`
  - Prevents cross-account identity merging
- **Events tracked**:
  - `lead_search` — when user performs a search (keyword, country, state, city, result count)
  - `lead_export` — CSV export
  - `lead_email_sent` — email outreach sent
  - `lead_report_generated` — PDF report generated
  - `site_generation_started` — Map2Web site generation initiated from Lead Scrapper
  - `$exception` — global error + unhandledrejection → PostHog error tracking
- **Session replay**: Enabled with text/input masking on `.sensitive` class + placeholder/value attributes
- **Note**: PostHog key/host are hardcoded in `index.html`. They are NOT present in this repo's `.env.example` (only the embedded Makerkit app uses `NEXT_PUBLIC_POSTHOG_*` env vars, defined in the Makerkit repo).

### Error Handling
- **Client**: ErrorBoundary.jsx wraps each page, shows retry UI
- **Client logging**: errorLogger.js -> POST to error-log.php
- **Server logging**: lib/error_logger.php -> JSON lines in logs/YYYY-MM-DD/error_log.jsonl
- **Error ID format**: ERR-LS-<MODULE>-<TIME36>-<RAND4> (app prefix = "LS")
- **Secrets stripped**: API keys, emails, tokens replaced with [REDACTED]
- **Digest emails**: error_notify_cron.php runs every 15 min, batches errors, sends via Resend

### Activity Logging
- Client: activityLogger.js -> POST to activity-log.php
- Server: lib/activity_logger.php -> JSON lines in logs/YYYY-MM-DD/activity_log.jsonl
- Dashboard: recent activity feed from log files

---

## 6. Environment Variables

From `.env.example` (actual contents):

```
RESEND_API_KEY=re_xxxxx
VITE_TURNSTILE_SITE_KEY=xxxxx
TURNSTILE_SECRET_KEY=xxxxx
APIFY_KEY_1=apify_api_xxxxx
APIFY_KEY_2=apify_api_xxxxx
# ... up to APIFY_KEY_10 documented in the example (code supports up to 21)
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJxxxxx
LEADSCRAPPER_SERVICE_TOKEN=xxxxx
MAP2WEB_SERVICE_TOKEN=xxxxx
MAP2WEB_ORIGIN=https://app.pixnom.com
```

PHP endpoints read these via `getenv()`.

> PostHog (`NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`) are NOT in this `.env.example`.
> They live in the embedded Makerkit app's environment; the standalone app hardcodes the key in `index.html`.

---

## 7. Database Schema (Key Tables)

### leadscrapper_leads_data (shared pool)
```sql
-- One row per business per search (shared across all users)
"UserEmail"    text        -- '__cache__' for pool rows
"PlaceId"      text        -- Google Maps Place ID
"SearchString" text        -- cache key (keyword|city,state|country)
"Name"         text        -- business name
"Phone"        text
"Website"      text
"Email"        text        -- extracted email
"Rating"       numeric
"Reviews"      integer
"Address"      text
"City"         text
"State"        text
"Country"      text
"Lat"          numeric
"Lng"          numeric
"Categories"   text
"Created_at"   timestamptz
```

### user_leadscrapper_leads (per-user state)
```sql
"CustomerID"    integer     -- from customer_lookup
"UserEmail"     text
"PlaceId"       text
"SearchString"  text
"Status"        text        -- 'delivered' | 'queued' | 'saved' | 'search'
"Notes"         text        -- user notes (Lead Manager)
"LeadScore"     numeric     -- user score (Lead Manager)
"ManagerStatus" text        -- kanban status (Lead Manager)
"SearchMeta"    jsonb       -- audit data (pool_size, delivered_count, etc.)
"CreatedAt"     timestamptz
```

### user_credits (Makerkit billing)
```sql
"id"           uuid
"Email"        text
"Credits"      numeric(10,2)
"CustomerID"   integer     -- assigned via assign_customer_id() RPC
"UpdatedAt"    timestamptz
"created_at"   timestamptz
```

### city_scrape_jobs
```sql
"id"              uuid
"search_key"      text       -- canonical key (e.g., "plumber|denver,co|us")
"keyword"         text
"country_code"    text
"state"           text
"city"            text
"status"          text       -- queued|running|completed|failed
"zips_total"      integer
"zips_done"       integer
"zips_failed"     integer
"pool_leads"      integer    -- denormalized count
"target_leads"    integer    -- stop scraping when pool reaches this (default 100)
"last_scraped_at" timestamptz
"created_at"      timestamptz
"updated_at"      timestamptz
```

### city_scrape_zips
```sql
"id"            bigint (identity)
"job_id"        uuid (FK -> city_scrape_jobs)
"zip"           text
"status"        text       -- queued|running|scraped|failed
"apify_run_id"  text
"leads_count"   integer
"attempts"      integer
"error"         text
"worker_id"     text
"started_at"    timestamptz
"heartbeat_at"  timestamptz
"scraped_at"    timestamptz
```

### plan_credits
```sql
"product_id" varchar(255)  -- Stripe product ID
"credits"    integer       -- credits granted per period
"notes"      text
```

### credit_grants
```sql
"id"                bigserial
"subscription_id"   text (FK -> subscriptions)
"account_id"        uuid
"email"             varchar(320)
"product_id"        varchar(255)
"period_starts_at"  timestamptz
"period_ends_at"    timestamptz
"credits_granted"   integer
"granted_at"        timestamptz
UNIQUE (subscription_id, period_starts_at, product_id)
```

### credit_revocations
```sql
"id"                bigserial
"subscription_id"   text
"account_id"        uuid
"email"             varchar(320)
"previous_credits"  numeric
"revoked_reason"    text
"revoked_at"        timestamptz
```

---

## 8. RPC Functions (Supabase)

| Function | Purpose |
|----------|---------|
| assign_customer_id(p_email) | Get or create CustomerID for an email |
| claim_next_zip(p_worker_id) | Atomic claim of oldest queued ZIP (FOR UPDATE SKIP LOCKED) |
| heartbeat_zip(p_zip_id, p_worker_id) | Keep long-running ZIP alive |
| reap_stuck_zips(p_stale_minutes) | Re-queue ZIPs whose worker died |
| finish_zip(p_zip_id, p_status, p_leads_count, ...) | Mark ZIP done/failed, bump job counters |
| pick_apify_key() | Select least-used healthy key + increment counter |
| cooldown_apify_key(p_key_ref, p_minutes) | Mark key exhausted (402/429) |
| jump_job_target(p_job_id, p_increment) | Raise job target so dormant city resumes |
| grant_subscription_credits() | Trigger: grant credits on subscription active/renewal |
| zero_credits_on_subscription_end() | Trigger: zero wallet when subscription ends |
| zero_credits_on_subscription_delete() | Trigger: zero wallet when subscription row deleted |
| credits_top_up(p_email, p_amount) | Increment user credits (with upsert) |

---

## 9. Deploy Process

### Standalone (leadscrapper.pixnom.com)

```bash
# Local
cd "D:\Lead Scrapper PROD"
npm run build          # -> dist/

# Upload via WinSCP
dist/ -> /var/www/leadscrapper.pixnom.com/dist/
*.php -> /var/www/leadscrapper.pixnom.com/
lib/ -> /var/www/leadscrapper.pixnom.com/lib/
utils/ -> /var/www/leadscrapper.pixnom.com/utils/
components/ -> /var/www/leadscrapper.pixnom.com/components/

# VPS
sudo systemctl reload nginx
```

### Embedded (app.pixnom.com)

Upload files to `/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/leadscrapper/`

```bash
# VPS
export PATH=/root/.nvm/versions/node/v20.18.0/bin:$PATH
cd /root/next-supabase-saas-kit-turbo-main
pnpm build
pm2 restart makerkit
```

---

## 10. Design Decisions

1. **Credits deducted on VIEW, not scrape**: City-wide scraping fills shared pool without charging anyone. Users pay when they actually see leads. This avoids charging for scrape failures or empty results.

2. **Replace policy for credits**: Plan switch or renewal replaces wallet with new plan amount. No rollover. Simpler mental model for users.

3. **Dev accounts bypass credits**: Two emails get 9999 credits and bypass all balance checks. Useful for testing and demos.

4. **File-based logging**: Errors and activity logged as JSON lines in logs/YYYY-MM-DD/ files. Rate-limited to avoid log spam. Digest emails sent every 15 min via cron.

5. **Keyword normalization**: Lowercase + trim + strip single trailing 's'. So "Plumbers", "plumber", " PLUMBER " all share the same cache key.

6. **Two-table architecture**: Shared pool (leadscrapper_leads_data) + per-user state (user_leadscrapper_leads). Avoids data duplication while enabling per-user dedup and Lead Manager features.

7. **City scrape target**: Worker stops scraping a city when pool reaches target_leads (default 100). Auto-resumes with +100 target if user needs more. Saves Apify quota.

8. **Embed via iframe**: Standalone app runs inside Makerkit via iframe with `?embed=true`. postMessage used to sync page state between parent and iframe.

---

## 11. Common Patterns

### PHP Supabase Helper
```php
require_once __DIR__ . '/lib/supabase.php';
$rows = sb_select('leadscrapper_leads_data', '*', ['SearchString' => $key, 'UserEmail' => '__cache__']);
sb_upsert('user_leadscrapper_leads', $row, ['CustomerID', 'PlaceId', 'SearchString', 'Status']);
```

### Credit Deduction (PHP)
```php
require_once __DIR__ . '/lib/credits.php';
$ok = credits_deduct_via_makerkit($email, $leadCount);
if (!$ok) { http_response_code(402); echo json_encode(['error' => 'insufficient credits']); exit; }
```

### Client-Side Logging
```javascript
import { logError } from './utils/errorLogger';
import { logActivity } from './utils/activityLogger';
logError('ApifyProxy', 500, { keyword, country });
logActivity('search', { keyword, results: leads.length });
```

---

## 12. Known Issues / TODO

- CLAUDE.md is empty (should contain project instructions for Claude)
- DEPLOY_SOP.md says standalone deploy has "No credit system, no login, no Supabase" — but codebase DOES have full credits/Supabase integration (dual-mode)
- Some .env.example values are placeholder (apify_api_xxxxx)
- Legacy Code.gs (Google Apps Script) still in repo — may be unused
- test_credits.php / debug.php / debug-cache.php / clean.php are debug/utility endpoints that should be removed or locked down in production
