# Activity Logging — Plan (self-hosted file logger)

**Goal:** record what each user *did* per day — searches, leads pulled, exports,
reports, websites generated, logins — using the **same file-based mechanism as the
error logger** (no Sentry, no Supabase, no PostHog). Per-day files, one JSON line
per event, grep/rollup to read back.

Decided with sir (2026-06-16): **both apps (LS + MW), all event types, files not Supabase.**

---

## 0. Why files (and the one trade-off)

- Mirrors the shipped error logger (`lib/error_logger.php` + `error-log.php`) — same
  `logs/` root, same `.htaccess` deny, same "never throws" safety rule. Zero new infra.
- **Trade-off accepted:** files can't `GROUP BY` across days. Per-day rollup is easy
  (read one folder); multi-day trends/charts would mean reading N folders. That's fine
  for "what did users do today." If trends are wanted later, replay files → a table.

---

## 0b. Folder layout (sir's chosen structure — 2026-06-16)

**One dated folder per day; both streams inside it as fixed filenames:**

```
logs/
  2026-06-16/
    error.log        ← errors    (one JSON line per error)
    activity.log     ← activity  (one JSON line per user action)
  2026-06-17/
    error.log
    activity.log
  .htaccess          ← deny-all (stays at logs/ root, covers subfolders)
```

- Keeps each day's error + activity together in one place.
- Errors and activity stay **separate files** (not merged) so "error.log non-empty =
  something broke" stays meaningful.

**⚠️ This CHANGES the existing error logger.** Today it writes the FLAT path
`logs/errors-YYYY-MM-DD.log`. It must switch to `logs/YYYY-MM-DD/error.log`:
  - `lib/error_logger.php`: `errlog_ensure_dir()` creates `logs/<date>/`; the write
    target becomes `ERRLOG_DIR . '/' . date('Y-m-d') . '/error.log'`.
  - Same change applied to the MW error logger (errorLogger.js / php twin).
  - Old flat `errors-*.log` files (06-07..06-14) stay as history; not migrated.
  - `activity-report.php` and any error-reader must glob the new dated path.

---

## 1. File format

`logs/YYYY-MM-DD/activity.log`, one JSON object per line:

```json
{"ts":"2026-06-16T22:03:24+05:30","app":"LS","email":"user@x.com",
 "event":"search","count":34,
 "meta":{"keyword":"plumber","city":"Denver","zip":"80202","mode":"single"},
 "ip":"49.36.33.153","userAgent":"Mozilla/..."}
```

- `app`: `LS` | `MW`
- `event`: see §3 event catalog
- `count`: integer payload for the event (leads delivered, rows exported, 1 for
  report/website, 0 for login). Lets `sum(count)` answer "how many leads today".
- `meta`: free-form per-event context (keyword/city/zip, reportId, siteType, url…).
- Timestamps in **IST (+05:30)** — same as error logger.
- Secrets stripped, fields clamped — reuse the error logger's helpers.

---

## 2. Components to build

### Leadscrapper (PHP)
1. **`lib/activity_logger.php`** — clone of `lib/error_logger.php`. One public fn:
   ```php
   log_activity($email, $event, $opts = [])
   //   opts: count(int), meta(array), source('backend'|'frontend'),
   //         ip, userAgent, app('LS')
   // → appends one line to logs/YYYY-MM-DD/activity.log; NEVER throws.
   ```
   Constants: `ACTLOG_DIR = logs/`, `ACTLOG_EVENTS` whitelist, max-size clamps.
   Reuses `errlog_strip_secrets()` / `errlog_clamp()` / `errlog_ensure_dir()` pattern
   (copy them in — keep the two libs independent so neither can break the other).

2. **`activity-log.php`** — frontend intake endpoint, clone of `error-log.php`
   (POST-only, CORS, ~30/min/IP rate limit, 32 KB cap). For browser-only events the
   backend never sees: login, export, report-view, page-open.
   Returns `{success:true}` (no ID needed — activity isn't user-facing).

3. **`utils/activityLogger.js`** — frontend helper, clone of `utils/errorLogger.js`
   (minus the global error hooks). Exposes:
   ```js
   logActivity(event, { count, meta })   // fire-and-forget POST to activity-log.php
   ```
   Same localhost/origin endpoint logic (`getEndpoint()`).

4. **`package.json` copy-php** — add `activity-log.php` + `lib/activity_logger.php`
   to the copy list (so build/deploy carries them, like the city-scrape files).

5. **`nginx`/`.htaccess`** — `logs/` is already denied; activity files inherit it.

### Map2Web
> ⚠️ **CONFIRM FIRST which MW codebase is in production.** Two exist on disk:
> - Node/Express: `D:\map2web.pixnom.com_2026-04-09_23_31_04\map2web.pixnom.com_whiteUI\`
>   (has `server/lib/errorLogger.js` — the one memory references)
> - PHP: `D:\maptosite buisness and restaurant PROD\` (apify-proxy.php, gemini-proxy.php…)
>
> The activity logger must clone whichever logger that prod app already uses:
> - **If Node:** `server/lib/activityLogger.js` (twin of errorLogger.js) + an
>   Express intake route + wire the generate-site controller + browser login.
> - **If PHP:** same PHP pattern as LS (`lib/activity_logger.php` + `activity-log.php`).

---

## 3. Event catalog + wiring points

| app | event | where to call | count | meta |
|-----|-------|---------------|-------|------|
| LS | `search` | `apify-proxy.php` after `applyCreditSlice()` (lines ~643/709) | leads delivered | keyword, city, zip, mode=single/city |
| LS | `city_search` | per ZIP pull in city flow (same slice path, mode=city) | leads delivered | keyword, city, zip |
| LS | `export` | `LeadSearch.jsx downloadCSV()` (~964) + `LeadManager.jsx exportCSV()` (~99) | row count | source=search/manager |
| LS | `report` | report generation (`app.jsx handleGoToReport` / ReportGenerator) | 1 | leadId, businessName |
| LS | `email_written` | EmailGenerator send/generate | 1 | leadId |
| LS | `login` | app.jsx after OTP verify / userEmail set | 0 | — |
| MW | `website_generated` | MW generate-site controller/proxy | 1 | businessType, url, template |
| MW | `login` | MW auth success (frontend) | 0 | — |

**Backend events** (`search`, `city_search`, `website_generated`) → logged server-side
where the credit/slice already happens (authoritative count, can't be spoofed).
**Frontend events** (`export`, `report`, `email_written`, `login`) → `logActivity()`
POST to the intake endpoint.

---

## 4. Reading it back — `activity-report.php?date=YYYY-MM-DD`

Tiny endpoint (admin-only, behind a query secret or IP allowlist) that reads one
day's file and returns per-user rollup:

```
GET /activity-report.php?date=2026-06-16&key=<secret>
→ {
    "date":"2026-06-16",
    "users":{
      "user@x.com":{"search":{"actions":5,"leads":340},"report":{"actions":2},
                    "export":{"actions":1,"rows":120},"login":{"actions":3}},
      ...
    },
    "totals":{"search":42,"leads":2870,"website_generated":7,...}
  }
```

Raw alternative (no endpoint): `grep user@x.com logs/2026-06-16/activity.log`.

(Optional later: a Makerkit admin page that calls this endpoint and renders a table.)

---

## 5. Build order (tasks)

- **AL-1** LS `lib/activity_logger.php`
- **AL-2** LS `activity-log.php` intake + `utils/activityLogger.js`
- **AL-3** LS wire backend events (`search`/`city_search` in apify-proxy.php)
- **AL-4** LS wire frontend events (export/report/email/login)
- **AL-5** LS `activity-report.php` rollup reader
- **AL-6** LS local E2E (probe each event lands a line) + build + deploy to VPS
- **AL-7** MW — confirm prod codebase, then clone logger + wire website_generated/login
- **AL-8** MW E2E + deploy

LS ships independently of MW (AL-1..6), so Leadscrapper is testable/live before MW
is touched.

---

## 6. Safety rules (inherited from error logger — non-negotiable)

- `log_activity()` / `logActivity()` **NEVER throw** — a logging failure must never
  break a search, export, or generate. Wrap in try/catch, fail silent.
- Secrets stripped from `meta` before write (reuse `errlog_strip_secrets`).
- Rate-limited + size-capped intake (reuse `error-log.php` guards).
- `logs/` stays denied at web level (already configured).
- Fire-and-forget on the frontend (don't await; never block the UI).

---

## Status: PLAN ONLY — not started. Awaiting go-ahead to build AL-1.
