# Error Logging System — Implementation Plan (Both Apps)

> **Goal:** When any user hits an error anywhere on app.pixnom.com (Lead Scrapper OR
> Map2Web), they see a short **Error ID** (e.g. `ERR-LS-LEAD-LXK9F2-A7F3`) they can
> report to us. The full error detail (user, page, stack trace, payload, timestamp) is
> written to a **log file on the VPS**. We grep the ID → instantly see what broke.
>
> **Approach:** Option 1 — self-hosted log files. No external service, zero cost.
>
> **Scope:** BOTH apps:
> | App | Code | Stack | Local path |
> |---|---|---|---|
> | Lead Scrapper | `LS` | React (Vite) + PHP proxies | `D:\Lead Scrapper PROD` |
> | Map2Web | `MW` | Vanilla JS + Node/Express server | `D:\map2web.pixnom.com_2026-04-09_23_31_04\map2web.pixnom.com_whiteUI` |
>
> Same Error ID format + same log line format everywhere → one mental model, one set of
> grep commands. Two logger implementations (PHP for LS backend, Node for MW backend).

---

## 1. Error ID Format

```
ERR-<APP>-<MODULE>-<TIME36>-<RAND>

Lead Scrapper examples:
ERR-LS-LEAD-LXK9F2-A7F3    ← Lead Search / Apify scraping failed
ERR-LS-MGR-LXK9F5-E2B7     ← Lead Manager (save/load/delete) failed
ERR-LS-RPT-LXK9F8-B2D1     ← Report Generator / PDF crashed
ERR-LS-BILL-LXK9G1-C9E4    ← Credits / billing error
ERR-LS-GEN-LXK9G5-D4A8     ← Anything else (fallback)

Map2Web examples:
ERR-MW-SCRAPE-LXK9H2-F1C3  ← Apify scraping of Maps URL failed
ERR-MW-AI-LXK9H4-A9D2      ← Gemini site-generation failed
ERR-MW-PUB-LXK9H6-B3E8     ← GitHub publish failed
ERR-MW-BILL-LXK9H8-C7F1    ← Credits deduction failed
ERR-MW-GEN-LXK9I1-D2A5     ← Anything else (fallback)
```

| Part | What | Why |
|---|---|---|
| `ERR` | Fixed prefix | User instantly knows it's an error ID |
| `LS` / `MW` | App tag | Know which app before opening anything |
| Module tag | See tables below | Know the module at a glance |
| `LXK9F2` | Timestamp base36 (`Date.now().toString(36)`) | Sortable, tells *when* |
| `A7F3` | 4 random hex chars | No collision in same millisecond |

### 1a. Lead Scrapper modules (`LS`)

| Code | Module | Frontend files | Backend files |
|---|---|---|---|
| `LEAD` | Lead Search / Apify scraping | `components/LeadSearch.jsx` | `apify-proxy.php` |
| `MGR` | Lead Manager (saved leads) | `components/LeadManager.jsx`, `LeadDetail.jsx` | `leads-proxy.php` |
| `RPT` | Report Generator / PDF | `components/ReportGenerator.jsx`, `utils/pdfGenerator.js`, `utils/gmbAudit.js` | `map2web-proxy.php` |
| `BILL` | Credits / billing | credit calls in `app.jsx` / `LeadSearch.jsx` | `leadscrapper-credits-proxy.php`, `lib/credits.php`, Makerkit `credits/get` + `credits/deduct-leads` |
| `GEN` | Everything else (Email Gen, Outreach, Posts, Reviews, Settings, unknown crashes) | remaining components, global ErrorBoundary | `sheets-proxy.php`, `extract-email.php`, `send-otp.php`, `shorten-url.php`, … |

### 1b. Map2Web modules (`MW`) — mapped to the Express routes

| Code | Module | Frontend (app.js area) | Backend (server/) |
|---|---|---|---|
| `SCRAPE` | Maps URL scraping | scrape flow in `app.js` | `routes/apifyRoutes.js`, `controllers/ApifyController.js` |
| `AI` | Gemini site generation | generation flow | `routes/geminiRoutes.js`, `controllers/GeminiController.js` |
| `PUB` | GitHub site publishing | publish flow | `routes/githubRoutes.js`, `controllers/GitHubController.js` |
| `BILL` | Credits check/deduct | credit calls in `app.js` | `routes/sheetsRoutes.js` + `controllers/SheetsController.js`, `controllers/SupabaseController.js`, Makerkit `makerkit-api-map2web` |
| `AUTH` | OTP login | OTP flow | `routes/otpRoutes.js`, `controllers/OTPController.js` |
| `AUTO` | Automation engine | — | `routes/automationRoutes.js`, `controllers/AutomationController.js` |
| `EMAIL` | Email sending | — | `routes/emailRoutes.js`, `controllers/EmailController.js` |
| `GEN` | Everything else / unknown frontend crashes | global `window.onerror` | any unhandled Express error |

> NOTE: Makerkit (Next.js shell at app.pixnom.com — login, billing pages) is **phase 2**.
> The pattern copies over easily (a small route handler + same log format), but it's a
> third codebase — let's land these two first.

---

## 2. Where Logs Are Saved

Each app keeps its own `logs/` folder next to its code — no shared folder, no
cross-app permission issues:

### Production (VPS `74.208.208.186`)
```
/var/www/leadscrapper.pixnom.com/
├── error-log.php                  ← NEW endpoint (receives LS frontend errors)
├── lib/error_logger.php           ← NEW shared PHP logger
└── logs/
    ├── errors-2026-06-05.log      ← one file per day, JSON lines
    └── .htaccess                  ← Deny from all

/var/www/map2web.pixnom.com/       ← (confirm exact path — see Q4 below)
└── server/
    ├── lib/errorLogger.js         ← NEW shared Node logger
    └── logs/
        └── errors-2026-06-05.log  ← NOT under web root (server/ isn't served) ✓
```

- **LS:** `logs/` is inside the web root → MUST be blocked: `.htaccess` (`Deny from all`)
  **plus** an nginx rule (server is nginx, `.htaccess` may be ignored):
  ```nginx
  location ^~ /logs/ { deny all; return 404; }
  ```
- **MW:** Express serves static files from the project root (`express.static(path.join(__dirname, '..'))`),
  but `server/logs/` lives under `server/` which IS inside that root — so we ALSO add an
  Express guard: `app.use('/server', (req,res)=>res.status(404).end())` (blocks `/server/*`
  entirely — controllers/.env/logs all become unreachable via HTTP; good hardening anyway).

### Local dev (Windows)
```
D:\Lead Scrapper PROD\logs\errors-YYYY-MM-DD.log
D:\map2web...\map2web.pixnom.com_whiteUI\server\logs\errors-YYYY-MM-DD.log
```
Same code, relative paths → works in both places. `logs/` added to both `.gitignore`s.

### Security rules (both apps)
1. Public URL access to log files blocked (rules above) — verified after deploy by
   requesting the log URL and expecting 404.
2. Log entries **never include secrets**: logger strips keys matching
   `apiKey|token|authorization|password|secret|key` from context before writing.
   (Extra important for MW — its config carries Apify/Gemini/GitHub tokens.)
3. Stack traces truncated to 4 KB; context to 2 KB → one entry can't bloat the file.

### Retention
One weekly cron on VPS covers both:
```
0 3 * * 0  find /var/www/leadscrapper.pixnom.com/logs /var/www/map2web.pixnom.com/server/logs -name "errors-*.log" -mtime +30 -delete
```
~1–2 KB per error → even 1,000 errors/day ≈ 60 MB/month max per app.

---

## 3. Log Entry Format (JSON Lines — identical in both apps)

```json
{"id":"ERR-LS-LEAD-LXK9F2-A7F3","ts":"2026-06-05T14:23:11+05:30","app":"LS","module":"LEAD","source":"frontend","user":"customer@gmail.com","page":"/","component":"LeadSearch","action":"startScraping","message":"Apify run timed out after 300s","stack":"Error: timeout\n  at pollRun (LeadSearch.jsx:412)...","context":{"searchString":"dentists in Pune","maxLeads":50},"userAgent":"Mozilla/5.0 ...","ip":"103.x.x.x"}
```

| Field | Filled by | Notes |
|---|---|---|
| `id` | generator | The Error ID shown to user |
| `ts` | logger | ISO-8601 with timezone |
| `app` | logger | `LS` or `MW` |
| `module` | call site | from the module tables above |
| `source` | logger | `frontend` or `backend` |
| `user` | call site | email from app state (or `anonymous`) |
| `page` / `component` / `action` | call site | where it happened |
| `message` / `stack` | the Error | truncated (4 KB) |
| `context` | call site | small object, secrets stripped |
| `userAgent` / `ip` | logger | browser + IP |

---

## 4. New Files To Create

### App A — Lead Scrapper (`D:\Lead Scrapper PROD`)

#### A1. `lib/error_logger.php` — shared backend logger
```
log_error(string $module, string $message, array $opts = []): string
```
- Generates Error ID (`ERR-LS-...`), builds JSON line, strips secret keys
- Appends with `file_put_contents(..., FILE_APPEND | LOCK_EX)` (no interleaved lines)
- Auto-creates `logs/` + `.htaccess` on first write (deploy can't forget)
- **Never throws** — on disk failure falls back to PHP `error_log()` (nginx log) and
  still returns an ID. Logging must never break the actual request.
- Returns the ID so proxies include it in their JSON error response

#### A2. `error-log.php` — intake endpoint for frontend errors
```
POST /error-log.php  { module, message, stack, user, page, component, action, context, errorId? }
```
- CORS headers same as existing proxies
- Reuses frontend-generated `errorId` if present, else generates one
- Clamps every field length; **rate limit** ~30 writes/min per IP (file-based counter)
  → an error loop in someone's browser can't flood the disk
- Responds `{ "success": true, "errorId": "ERR-LS-..." }`

#### A3. `utils/errorLogger.js` — frontend logger util (React)
```js
logError(module, error, { user, component, action, context })  → errorId
```
- Generates ID **locally first** (instant, works offline), fire-and-forget POST to
  `error-log.php` (same `isLocalhost()` URL pattern as `getLeadsProxyUrl()` in `app.jsx`)
- Dedupe guard: same message 5+ times in 60s → log once
- Exports `MODULES = { LEAD, MGR, RPT, BILL, GEN }`

#### A4. `components/ErrorBoundary.jsx` — React crash catcher
- `componentDidCatch` → `logError(module, …)`, renders friendly fallback:

```
┌──────────────────────────────────────────────┐
│  ⚠️  Something went wrong                    │
│  If you contact support, please share        │
│  this Error ID:                              │
│  ┌────────────────────────────┐              │
│  │  ERR-LS-LEAD-LXK9F2-A7F3 📋│  ← copy btn  │
│  └────────────────────────────┘              │
│           [ Reload page ]                    │
└──────────────────────────────────────────────┘
```

### App B — Map2Web (`...\map2web.pixnom.com_whiteUI`)

#### B1. `server/lib/errorLogger.js` — shared Node logger
```js
logError(module, message, opts)  → errorId      // same signature idea as PHP one
```
- Same ID format (`ERR-MW-...`), same JSON line format, same secret-stripping
- Appends via `fs.appendFileSync` to `server/logs/errors-<date>.log`
  (sync append of one line is atomic enough at this traffic level; never throws —
  falls back to `console.error` on disk failure)

#### B2. Express wiring in `server/index.js`
- `POST /api/log-error` — intake endpoint for MW frontend errors (validation + same
  per-IP rate limit)
- **Global Express error middleware** (registered after all routes):
  ```js
  app.use((err, req, res, next) => {
    const errorId = logError(moduleFromPath(req.path), err.message, {...});
    res.status(500).json({ error: 'Internal server error', errorId });
  });
  ```
  `moduleFromPath()`: `/api/scrape/*`→SCRAPE, `/api/ai/*`→AI, `/api/publish/*`→PUB,
  `/api/auth/*`→AUTH, `/api/automation/*`→AUTO, `/api/email/*`→EMAIL,
  `/api/sheets/*`+`/api/supabase/*`→BILL, else GEN
- `process.on('uncaughtException' / 'unhandledRejection')` → log with module GEN
  (log + keep the formatted entry even if the process then dies/restarts)
- Block `/server/*` from static serving (security hardening, see §2)

#### B3. `utils/errorLogger.browser.js` — MW frontend logger (vanilla JS)
- Same as A3 but plain `<script>`-loadable (no modules needed by `app.js`)
- Installs `window.onerror` + `window.onunhandledrejection` automatically
- Shows the Error ID by appending a line to MW's existing error toast/alert UI
  (I'll match whatever pattern `app.js` already uses for error display)

---

## 5. Existing Files To Modify

### Lead Scrapper frontend

| File | Change |
|---|---|
| `app.jsx` | 1) Wrap each module's render in `<ErrorBoundary module="...">` (crash in Reports doesn't kill Lead Search; ID gets right module tag). 2) `window.onerror` + `window.onunhandledrejection` → `logError('GEN', …)`. |
| `components/LeadSearch.jsx` | In the user-facing `catch` blocks (~6–8 of the 34): `logError(MODULES.LEAD, …)` + append `Error ID: ${id}` to the message already shown. Credit catches → `MODULES.BILL`. |
| `components/LeadManager.jsx` | Same with `MODULES.MGR`. |
| `components/ReportGenerator.jsx` + `utils/pdfGenerator.js` | `MODULES.RPT`. |
| Other components | Covered by ErrorBoundary (`GEN`) — no per-catch wiring in phase 1. |

### Lead Scrapper backend (PHP proxies)

| File | Change |
|---|---|
| `leads-proxy.php` | `require lib/error_logger.php`; existing `fail()` helper logs on 5xx and adds `"errorId"` to the JSON response. 4xx user errors NOT logged (not bugs). |
| `apify-proxy.php` | Its existing `set_error_handler`/`register_shutdown_function` call `log_error('LEAD', …)` + return `errorId`. Also log Apify run failures / keys exhausted. |
| `leadscrapper-credits-proxy.php` | Same pattern, `BILL`. |
| `map2web-proxy.php` | Same pattern, `RPT`. |
| `sheets-proxy.php`, `extract-email.php`, `send-otp.php`, `shorten-url.php` | Same pattern, `GEN`. |

### Map2Web frontend

| File | Change |
|---|---|
| `index.html` | Load `utils/errorLogger.browser.js` before `app.js`. |
| `app.js` | In main flow catch blocks (scrape, generate, publish, credits): `logError('SCRAPE'/'AI'/'PUB'/'BILL', …)` + show ID in the existing error UI. If a server response already carries `errorId`, display that one instead of generating a new one. |

### Map2Web backend (Express)

| File | Change |
|---|---|
| `server/index.js` | Add §B2: error middleware, `/api/log-error` route, process-level handlers, `/server/*` block. |
| `server/controllers/*.js` (8 files) | In catch blocks that currently `res.status(500).json(...)`: add `logError(<module>, …)` and include `errorId` in response. Controllers that already `next(err)` need nothing — middleware catches them. |

> Principle for ALL of the above: **don't change any error-handling logic** — existing
> catches keep doing exactly what they do; we only ADD the log call + show the ID.
> Zero behavior risk.

---

## 6. Error Flow (same in both apps)

### Case A — frontend crash / JS error
```
Component throws → ErrorBoundary / window.onerror catches
→ logger generates ERR-… locally (instant) → user sees ID + copy button
→ fire-and-forget POST to intake endpoint → log line written
```

### Case B — backend fails (most common in production)
```
Frontend calls backend → backend hits 500
→ backend log_error() writes line, returns { error, errorId }
→ frontend displays THAT errorId (no double-logging, one error = one ID)
```

### Case C — network totally dead
```
Frontend generates ID locally → user still sees an ID
POST fails silently → log line missing, but ID encodes app+module+timestamp,
so we still know roughly what/when. Best effort, never blocks the UI.
```

---

## 7. How We (Admins) Use It

User reports: *"I got error ERR-MW-PUB-LXK9H6-B3E8"* → the ID itself says:
Map2Web, GitHub publish module. Then:

```bash
ssh root@74.208.208.186
grep -h "ERR-MW-PUB-LXK9H6-B3E8" /var/www/map2web.pixnom.com/server/logs/errors-*.log | python3 -m json.tool
```

Cheat-sheet (will be added to DEPLOY_SOP.md):
```bash
# search both apps at once (the app tag tells you where, but just in case)
grep -rh "ERR-LS-LEAD-LXK9F2-A7F3" /var/www/*/logs/ /var/www/*/server/logs/

# live tail today's errors (either app)
tail -f /var/www/leadscrapper.pixnom.com/logs/errors-$(date +%F).log

# today's error count per module
grep -oP '"module":"\w+"' errors-$(date +%F).log | sort | uniq -c
```

---

## 8. Implementation Order

### Phase 1 — Lead Scrapper (~4.5 h)
| # | Step | Files | Est. |
|---|---|---|---|
| 1 | PHP logger lib (ID gen, JSON writer, secret-strip, auto-create logs/+.htaccess) | `lib/error_logger.php` | 30 min |
| 2 | Intake endpoint (validation + rate limit) | `error-log.php` | 20 min |
| 3 | Frontend logger util | `utils/errorLogger.js` | 20 min |
| 4 | ErrorBoundary + fallback UI with copy button | `components/ErrorBoundary.jsx` | 25 min |
| 5 | Wire `app.jsx` (boundaries + global hooks) | `app.jsx` | 20 min |
| 6 | Wire PHP proxies (log + return errorId) | 7 proxy files | 40 min |
| 7 | Wire key frontend catches (LeadSearch / LeadManager / ReportGenerator) | 3 components + `pdfGenerator.js` | 40 min |
| 8 | Local E2E test: force an error in each module, verify log lines + IDs match UI | — | 30 min |
| 9 | Build + deploy, nginx deny rule, retention cron, verify logs URL = 404 | VPS | 30 min |

### Phase 2 — Map2Web (~3.5 h)
| # | Step | Files | Est. |
|---|---|---|---|
| 10 | Node logger lib (same format) | `server/lib/errorLogger.js` | 30 min |
| 11 | Express wiring: error middleware, `/api/log-error`, process handlers, `/server/*` block | `server/index.js` | 30 min |
| 12 | Wire 8 controllers (log + return errorId) | `server/controllers/*.js` | 50 min |
| 13 | Browser logger + global hooks | `utils/errorLogger.browser.js`, `index.html` | 25 min |
| 14 | Wire `app.js` main-flow catches + show ID in existing error UI | `app.js` | 40 min |
| 15 | Local E2E test (force errors per module) | — | 25 min |
| 16 | Deploy MW, extend retention cron, verify `/server/*` returns 404 | VPS | 30 min |

### Phase 3 — docs (~15 min)
| 17 | grep cheat-sheet + "how to handle a user error report" SOP | `DEPLOY_SOP.md` | 15 min |

**Total: ~8.5 hours across both apps** (each phase independently testable/deployable —
LS can go live before MW is touched).

---

## 9. NOT Included (future, optional)

- ❌ Admin web UI to browse logs (now: SSH + grep; later a small protected viewer page)
- ❌ Email/Telegram alert on new errors (easy bolt-on: one hook inside each logger)
- ⏳ Makerkit (Next.js shell at app.pixnom.com) logging — **CONFIRMED as future Phase 4** (sir chose Option A on 2026-06-05): same pattern, `ERR-MK-...` IDs, covers login/billing pages + credits API routes. Do after LS + MW are deployed.
- ❌ Sentry — can be layered on top anytime; nothing here blocks it

---

## 10. Open Questions for Sir (answer before I start)

1. **Module codes OK?**
   - LS: `LEAD / MGR / RPT / BILL / GEN`
   - MW: `SCRAPE / AI / PUB / BILL / AUTH / AUTO / EMAIL / GEN`
2. **Timezone for log timestamps:** IST (`+05:30`) or UTC? → I recommend **IST** (easier to read when a user says "it broke 10 minutes ago").
3. **Log only real failures (5xx/crashes), or also user errors** like "insufficient credits" / invalid input? → I recommend **only real failures** — otherwise logs fill with noise that isn't bugs.
4. **Map2Web production path on VPS** — is it `/var/www/map2web.pixnom.com/`? (I know the LS path from memory; need to confirm MW's, and whether the Node server runs under pm2/systemd.)
5. **Start with Phase 1 (Lead Scrapper) and deploy it first**, then do Map2Web? Or build both fully before any deploy? → I recommend deploy LS first — real errors start getting captured a day earlier and we validate the design before duplicating it.
