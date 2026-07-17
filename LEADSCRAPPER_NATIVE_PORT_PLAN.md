# Lead Scrapper → Native SaaS Port Plan

**Goal:** Make Lead Scrapper run *inside* `app.pixnom.com` as real code — exactly like
map2web already does — so that deleting `leadscrapper.pixnom.com` (on MilesWeb or
anywhere) has zero effect on the SaaS. After this port, the standalone domain can be
retired permanently.

**Status:** PLAN ONLY — no code changes yet.
**Written:** 2026-07-17

---

## 1. Why this is needed (the root cause)

Today the SaaS embeds Lead Scrapper as a **live iframe**:

- `makerkit-leadscrapper/_components/LeadscrapperFrame.tsx:22` builds
  `src = https://leadscrapper.pixnom.com?embed=true&page=...&email=...`
- Every SaaS page under `/home/leadscrapper/*` is just an empty shell that loads that
  external URL in an `<iframe>`.

So the *actual app still lives on the standalone MilesWeb domain*. Delete the domain →
the iframe has nothing to load → the whole Lead Scrapper section breaks.

map2web does **not** do this. It was ported natively:
- PHP proxies → Next.js API routes (`makerkit-api-map2web/{scrape,generate,build,publish}/route.ts`)
- SPA → native React pages (`makerkit-map2web/{home,history,emailwriter}/page.tsx`)
- **No iframe, no reference to `map2web.pixnom.com`** → deleting that domain does nothing.

This plan applies the same pattern to Lead Scrapper.

---

## 2. What Lead Scrapper is actually made of (inventory)

### Frontend — Vite/React SPA, ~5,400 lines
| File | Lines | Role |
|---|---|---|
| `app.jsx` | 862 | Root: page-state router, Supabase storage glue, site-gen orchestration |
| `components/LeadSearch.jsx` | 1,716 | **Biggest.** Find-leads search UI (country-state-city + zipcodes libs) |
| `components/LeadManager.jsx` | 607 | Saved-leads table, bulk actions, site generation |
| `components/ReportGenerator.jsx` | 298 | PDF reports (jspdf + html2canvas) |
| `components/EmailGenerator.jsx` | 190 | AI email — **template/mock, no live backend** |
| `components/SearchableDropdown.jsx` | 162 | Shared UI control |
| `components/Dashboard.jsx` | 141 | KPI overview |
| `components/EmailOutreach.jsx` | 144 | Sent-email log |
| `components/ReviewResponder.jsx` | 138 | **template/mock** |
| `components/PostCreator.jsx` | 124 | **template/mock** |
| `components/Settings.jsx` | 120 | BYOK Apify key, prefs |
| `components/LeadDetail.jsx` | 100 | Single-lead detail view |
| `components/{Sidebar,TopNavbar,ErrorBoundary}.jsx` | 344 | Shell — **dropped in embed mode** |
| `utils/*.js` | — | map2web bridge, email extractor, pdf gen, error/activity loggers, helpers |

**Routing note:** the SPA does NOT use real URLs. It switches views via a `page`
state variable + `postMessage` from the parent (`app.jsx:433-515`). Native port
replaces this with real Next.js routes (one folder per page) — the map2web pattern.

**AI generators are mock/template** (confirmed: EmailGenerator/PostCreator/
ReviewResponder pull from `utils/mockData.js`, no network call). So there is **no AI
backend to port** — big scope reducer.

### Backend — PHP proxies, ~5,000 lines (~15 files)
| File | Lines | Becomes |
|---|---|---|
| `apify-proxy.php` | 811 | `api/leadscrapper/search/route.ts` — Apify run/check/dataset + credit slicing + cache |
| `lib/credits.php` | 611 | shared credit lib → TS helper (or reuse existing SaaS credit bridge) |
| `lib/supabase_cache.php` | 381 | cache read/write → TS (or Supabase table calls) |
| `leads-proxy.php` | 350 | `api/leadscrapper/leads/route.ts` — load/save/update/delete/bulk |
| `lib/city_scrape.php` + `city-scrape-proxy.php` + `city_scrape_worker.php` | 815 | city-scrape feature (background worker — see risks) |
| `apify-key.php` | 180 | BYOK key mgmt → `api/leadscrapper/apify-key/route.ts` |
| `lib/supabase.php` | 132 | replaced by `@kit/supabase` admin client |
| `extract-email.php` | 151 | `api/leadscrapper/extract-email/route.ts` |
| `lib/activity_logger.php` + `activity-log.php` + `activity-report.php` | 338 | activity logging → TS |
| `lib/error_logger.php` + `error-log.php` | 259 | already have SaaS-side error logging — consolidate |
| `send-otp.php`, `shorten-url.php`, `sheets-proxy.php`, `map2web-proxy.php`, `turnstile-key.php`, `clean.php`, `debug*.php`, `test_credits.php`, `error_notify_cron.php` | ~700 | audit — several are dead/standalone-only and can be dropped |

### External services (unchanged by the port — still called, just from route.ts)
- **Apify** — `https://api.apify.com` (Google Maps scraper). Keys stay in `.env`.
- **Supabase** — lead pool, credits, cache tables. SaaS already has admin client.
- **map2web Cloud Run** — `apify-service`, `gemini-service`, `github-publisher`
  (used by "Generate Site" on a lead, via `utils/map2web.js`). Already reachable from
  the SaaS since map2web uses them — reuse `makerkit-api-map2web/_config.ts` pattern.

---

## 2b. Server deployment reality (verified on VPS 2026-07-17)

Confirmed by inspecting pm2 + nginx + the makerkit source tree on the server:

- **makerkit = pm2 id 6**, `next-server` on **port 3000**, cwd
  `/root/next-supabase-saas-kit-turbo-main/apps/web`, served at `app.pixnom.com`.
- **map2web IS ALREADY IN-PROCESS inside makerkit.** Its code lives at
  `.../apps/web/app/*/home/*/map2web/` (pages) and `.../apps/web/app/api/map2web/`
  (routes) — running on port 3000 as part of makerkit. There is NO nginx
  `location /home/map2web` proxy to any other port.
- **The pm2 `map2web` (id 13, port 4000) is the DEAD legacy standalone** app
  (`map2web.pixnom.com`). The SaaS does not depend on it — which is exactly why
  deleting `map2web.pixnom.com` had no effect.
- **Lead Scrapper today is hosted on MILESWEB, not the VPS.** DNS (nameservers
  `*.mydnsvault.com`) resolves `leadscrapper.pixnom.com` → `103.212.121.63` =
  `optimus.herosite.pro`, a **MilesWeb shared-hosting server running LiteSpeed**. It
  serves the static Vite `dist/` + PHP files there; PHP calls out to Apify + Supabase.
  The VPS `app.pixnom.com` (nginx, 74.208.208.186) just **iframes that MilesWeb URL**.
  There is a leftover `/var/www/leadscrapper.pixnom.com` + `sites-enabled/leadscrapper`
  vhost ON the VPS, but DNS does NOT point at the VPS for this domain — that copy is a
  stale remnant receiving no public traffic. "No pm2 process / no port" is because it's
  a static+PHP site on MilesWeb LiteSpeed, not a Node app.
- **The MilesWeb dependency is the actual coupling:** deleting `leadscrapper.pixnom.com`
  in MilesWeb stops LiteSpeed serving the files → the SaaS iframe URL dies → LS section
  goes blank. The native port removes this by moving LS into makerkit on the VPS.

**Ports currently in use:** 3000 (makerkit), 3002 (website-builder), 3003
(snappycontract), 4000 (legacy map2web), 5000 (uptime). Free if ever needed: 3001, 3004.

### How many NEW ports does the native port need? → **ZERO.**

Lead Scrapper gets ported IN-PROCESS into makerkit (same as map2web really is):
- Pages → `.../apps/web/app/[locale]/home/(user)/leadscrapper/*`
- API routes → `.../apps/web/app/api/leadscrapper/*`

Result: **0 new HTTP ports, 0 new pm2 processes, 0 new nginx blocks.** Deploy = build +
`pm2 restart makerkit`. After it works, delete the `leadscrapper` nginx vhost +
`/var/www/leadscrapper.pixnom.com` — SaaS unaffected.

**Only exception:** the city-scrape background worker (`city_scrape_worker.php`), IF
kept as-is, needs 1 background pm2 process — a worker loop, NOT a web port (like
`uptimedesk-backend`). If dropped or moved to a queue, even that is zero.

---

## 3. Target structure (mirrors map2web)

```
apps/web/app/[locale]/home/(user)/leadscrapper/
├── layout.tsx                 # provider shell (PostHog etc.)
├── page.tsx                   # dashboard (default)
├── find-leads/page.tsx        # LeadSearch (the 1,716-line beast)
├── lead-manager/page.tsx      # LeadManager
├── ai-email-writer/page.tsx   # EmailGenerator (mock)
├── pdf-reports/page.tsx       # ReportGenerator
├── review-responder/page.tsx  # ReviewResponder (mock)
├── post-creator/page.tsx      # PostCreator (mock)
├── email-outreach/page.tsx    # EmailOutreach
├── settings/page.tsx          # Settings (BYOK)
└── _components/               # ported React components (no Sidebar/TopNavbar — SaaS provides those)

apps/web/app/api/leadscrapper/
├── search/route.ts            # ← apify-proxy.php
├── leads/route.ts             # ← leads-proxy.php
├── apify-key/route.ts         # ← apify-key.php
├── extract-email/route.ts     # ← extract-email.php
├── city-scrape/route.ts       # ← city-scrape-proxy.php (+ worker strategy, see risks)
└── _config.ts                 # Apify/Supabase/CloudRun endpoints + keys (map2web _config.ts pattern)
```

The `makerkit-leadscrapper/*/page.tsx` stubs already exist (find-leads, lead-manager,
etc.) — they currently render `LeadscrapperFrame`. Each gets rewritten to render the
real ported component instead.

---

## 4. Migration phases

### Phase 0 — Prep & decisions (before any code)
- Confirm Supabase table names/columns match between standalone and SaaS Supabase
  (they should — both already share the pool; see [[two-table-redesign]]).
- Decide credit handling: reuse the **existing SaaS credit bridge**
  ([[makerkit-dev-emails]]) instead of re-porting `lib/credits.php` verbatim.
- Confirm `.env` on the VPS/SaaS has: Apify keys, Supabase secret, map2web Cloud Run
  URLs + `M2W_API_KEY`.
- Decide fate of the **city-scrape background worker** (biggest risk — see §6).

### Phase 1 — Backend API routes (the hard half)
Port PHP → `route.ts`, one endpoint at a time, verifying each against the live
standalone behavior:
1. `search/route.ts` (from `apify-proxy.php`) — run/check/dataset polling, credit
   slice, cache. **Largest single piece.**
2. `leads/route.ts` (from `leads-proxy.php`) — CRUD + bulkSave.
3. `apify-key/route.ts`, `extract-email/route.ts`.
4. Credit + cache logic — wire to existing SaaS infra rather than re-porting.
5. city-scrape — see §6 for the worker decision.

### Phase 2 — Frontend components
Port React components to run natively (no iframe, no embed mode):
1. Strip embed logic from `app.jsx` — its page-state router is replaced by Next.js
   routes; the shell (`Sidebar`/`TopNavbar`) is dropped (SaaS provides chrome).
2. Repoint all `fetch()` calls from `*.php` → `/api/leadscrapper/*`.
3. Port `LeadSearch.jsx` (biggest), then LeadManager, Dashboard, ReportGenerator,
   Settings, the 3 mock generators, EmailOutreach, LeadDetail.
4. Reconcile styling: standalone uses **DaisyUI** classes (`btn`, `card`,
   `loading-spinner`, `base-200`…). SaaS uses `@kit/ui` + shadcn/Tailwind. Either pull
   DaisyUI into the SaaS OR restyle. **This is a real, easily-underestimated cost.**
5. Keep `utils/` (map2web bridge, pdf, email extractor) — mostly framework-agnostic.

### Phase 3 — Wire routes & swap the iframe
- Rewrite each `makerkit-leadscrapper/*/page.tsx` to render the ported component
  instead of `LeadscrapperFrame`.
- Delete `LeadscrapperFrame.tsx` + `LeadscrapperFrameClient.tsx`.

### Phase 4 — Test & verify
- Full flow: search → save → manage → status/notes → report → generate-site →
  settings/BYOK → credit deduction. Verify credits deduct once (not doubled).
- Compare against standalone side-by-side before cutting over.

### Phase 5 — Cutover & retire domain
- Deploy to VPS (`74.208.208.186`, see [[vps-deploy]]).
- Smoke-test on `app.pixnom.com`.
- Only then delete `leadscrapper.pixnom.com`.

---

## 5. Time estimate

Assumes one experienced full-stack dev (or me doing the bulk with your review at each
phase). Ranges reflect uncertainty in the two risk areas (§6).

| Phase | Work | Optimistic | Likely | Pessimistic |
|---|---|---|---|---|
| 0 | Prep & decisions | 0.5 d | 1 d | 1.5 d |
| 1 | Backend API routes (~5k PHP → TS) | 3 d | 5 d | 8 d |
| 2 | Frontend port + DaisyUI/shadcn styling | 4 d | 6 d | 10 d |
| 3 | Wire routes, remove iframe | 0.5 d | 1 d | 1.5 d |
| 4 | Test & verify | 1.5 d | 2.5 d | 4 d |
| 5 | Cutover & retire domain | 0.5 d | 1 d | 1.5 d |
| **Total** | | **~10 days** | **~16 days** | **~26 days** |

**Plain-language:** roughly **2 to 3.5 working weeks**. Most-likely case ≈ **3 weeks**.
For comparison, map2web was ~1 week — Lead Scrapper is 3–4× the code, hence the
multiple. If we cut/simplify the risk items in §6, the likely case drops toward ~2 weeks.

---

## 6. Risks & things that inflate the estimate

1. **city-scrape background worker.** `city_scrape_worker.php` runs as a long-lived
   background loop with a lock file (`.city_scrape_worker.lock`). Next.js/Vercel-style
   serverless routes can't hold a long process the same way. Options: (a) keep this ONE
   piece as a separate cron/worker on the VPS, (b) move to a queue (Trigger.dev/QStash),
   (c) drop the feature if unused. **Biggest single unknown.** If we keep the iframe-free
   goal but park city-scrape as a VPS cron, that's cheaper than a full rewrite.
2. **Styling mismatch (DaisyUI → shadcn/@kit/ui).** ~5k lines of JSX use DaisyUI
   classes. Bringing DaisyUI into the SaaS is fast but may clash with the SaaS theme;
   restyling is cleaner but slower. Pick early.
3. **Credit double-charge / disagreement.** Deduction must go through ONE path. Reuse
   the SaaS credit bridge; watch the dev-email bypass ([[makerkit-dev-emails]]).
4. **Supabase schema casts.** bigint/double columns need null-casts on empty strings
   ([[supabase-cache-schema]]) — carry these into the TS inserts.
5. **`LeadSearch.jsx` size (1,716 lines).** Heaviest component; pulls big libs
   (country-state-city ~7.7MB, zipcodes). Needs lazy-loading so it doesn't bloat the
   SaaS bundle.
6. **Dead/standalone-only PHP.** send-otp, turnstile, shorten-url, debug*, sheets-proxy
   may be obsolete — audit before porting so we don't port dead weight.

---

## 7. Cheaper alternative (for reference — you chose the full port)

If timeline pressure hits, the intermediate option is: **keep the iframe but self-host
`leadscrapper.pixnom.com` on your own VPS** (where the SaaS already runs) instead of
MilesWeb. That removes the MilesWeb dependency in ~1 day with no rewrite — but it's
still an iframe, not a true native port. You opted for the full port; noting this only
as a fallback if scope needs to shrink mid-way.
