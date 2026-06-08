# Map2Web Security Fixes — Plan (PENDING, do after error logging)

> **Status:** NOT STARTED — sir's decision: finish error logging first, then this.
> **Verified live on 2026-06-05** via curl from dev machine — this is NOT theoretical.
> Map2Web local code: `D:\map2web.pixnom.com_2026-04-09_23_31_04\map2web.pixnom.com_whiteUI`

---

## 1. Confirmed Exposure (production, map2web.pixnom.com)

| URL | Status | Exposes |
|---|---|---|
| `https://map2web.pixnom.com/config.js` | **200 OPEN** | `apifyToken` (apify_api_gtlX…), `geminiApiKey` (AIzaSyBsLv…), `apiSecretKey` (m2w_sk_7xPq…), Firebase web config |
| `https://map2web.pixnom.com/server/index.js` | **200 OPEN** | Express server source |
| `https://map2web.pixnom.com/server/controllers/*.js` | **200 OPEN** | All 8 controllers (Apify, Gemini, GitHub, OTP, Sheets, Supabase, Email, Automation) |
| `https://map2web.pixnom.com/server/lib/supabase.js` | **200 OPEN** | Supabase client code |
| `https://map2web.pixnom.com/migrations/…` | presumed open | DB schema |
| `https://map2web.pixnom.com/.env` | 404 safe | Express ignores dotfiles by default (lucky, not by design) |

**Root cause:** `server/index.js` (~line 35):
```js
app.use(express.static(path.join(__dirname, '..')));   // serves ENTIRE project root
```
Plus `config.js` was designed to hold secrets client-side ("This is the SINGLE place
for all credentials" — its own header comment says so).

**Keys to treat as COMPROMISED** (publicly downloadable for an unknown period):
1. 🔴 Apify token — someone can burn scraping credits
2. 🔴 Gemini API key — someone can run up Google AI bill
3. 🔴 `apiSecretKey` (m2w_sk_…) — whatever the server gates with it is open
4. 🟡 Firebase web `apiKey` — designed to be public, low concern (but verify Firebase security rules anyway)

---

## 2. Fix Plan — 3 Layers, in order

### Layer 1 — Block static serving of internals (~15 min, zero functional risk)
In `server/index.js`, add BEFORE the `express.static` line:
```js
// Block server internals & sensitive paths from static serving
const BLOCKED = [
  /^\/server(\/|$)/,
  /^\/migrations(\/|$)/,
  /^\/\.env/,
  /^\/makerkit/,          // makerkit-api-* and makerkit-map2web folders
  /^\/supabase(\/|$)/,
  /^\/docs(\/|$)/,
  /^\/node_modules(\/|$)/,
];
app.use((req, res, next) => {
  if (BLOCKED.some(rx => rx.test(req.path))) return res.status(404).end();
  next();
});
```
Fixes the `/server/*` + `/migrations/*` exposure completely; hard-locks `.env`.
Also protects the future `server/logs/` (error-logging plan, see `log_errors.md`).

### Layer 2 — Move secrets out of config.js (~1.5–2 h, the real fix)
Server already HAS controllers for Apify (`ApifyController.js`) and Gemini
(`GeminiController.js`) with routes `/api/scrape/apify` and `/api/ai` — and `.env`
already has `APIFY_TOKEN` + `GEMINI_API_KEY`. So the browser never needed the keys.

Steps:
1. Grep `app.js` (and any other frontend file) for `APP_CONFIG.apifyToken`,
   `APP_CONFIG.geminiApiKey`, `APP_CONFIG.apiSecretKey` → reroute each direct
   external API call through the existing `/api/...` routes instead.
2. Check the controllers read keys from `process.env` (not from config.js) — fix if not.
3. Delete `apifyToken`, `geminiApiKey`, `apiSecretKey` from `config.js`.
   KEEP: Firebase web config (designed to be public), non-secret URLs
   (sheetsCreditUrl, n8nWebhookUrl — verify these don't grant write access; if the
   Sheets URL allows credit WRITES, it must move server-side too).
4. Decide what `apiSecretKey` actually protects (grep server for `m2w_sk_` /
   `apiSecretKey`) — replace mechanism with a server-side check or a new rotated value
   stored only in `.env`.
5. Local test: scrape → generate → publish full flow with keys absent from browser.
6. Deploy.

### Layer 3 — Key rotation (sir does this, ~20 min, immediately AFTER Layer 2 deploy)
> Rotating BEFORE Layer 2 would break the live app (browser still needs old keys).
1. Apify: Console → Settings → API tokens → create new, revoke `apify_api_gtlXEUH9…`
2. Gemini: Google AI Studio → new API key, delete `AIzaSyBsLvUdi4…`
3. `apiSecretKey`: generate fresh random value (only in `.env`)
4. Update VPS `.env` with all new values, restart Node server (pm2?)
5. Re-verify: `curl https://map2web.pixnom.com/config.js` → no secrets in response

### Layer 4 — nginx hardening on VPS (~10 min, belt-and-suspenders)
```nginx
location ~ ^/(server|migrations|supabase|docs|node_modules|\.env) { deny all; return 404; }
```
Add to map2web site config (path on VPS TBC — ask sir / check nginx sites-enabled),
`nginx -t && systemctl reload nginx`.

### Post-fix verification checklist
- [ ] `curl https://map2web.pixnom.com/config.js` → 200 but NO secret keys in body
- [ ] `curl https://map2web.pixnom.com/server/index.js` → 404
- [ ] `curl https://map2web.pixnom.com/migrations/` → 404
- [ ] `curl https://map2web.pixnom.com/.env` → 404
- [ ] Full user flow works: login → scrape Maps URL → generate site → publish
- [ ] Old Apify token revoked & errors out
- [ ] Old Gemini key deleted & errors out
- [ ] Check Apify + Google billing for suspicious usage during exposure window

---

## 2a. ✅ DONE (2026-06-07): leadscrapper.pixnom.com audit + debug.php removed

- Audited leadscrapper domain: `.env` 404 ✓, no real config.js (SPA try_files fallback
  makes missing files return index.html with HTTP 200 — looks alarming in curl, is harmless).
- `debug.php` WAS live (leaked PHP version + extension list — recon value, no secrets).
  → Deleted from VPS, removed from package.json copy-php script, verified 404. DONE.

## 2b. BONUS finding (Lead Scrapper, found 2026-06-05 during logging work)

- 🔴 `send-otp.php` line ~39 has a **hardcoded Resend API key fallback** in source:
  `$RESEND_API_KEY = $envConfig['RESEND_API_KEY'] ?? 're_CJdJkCQu_FNFo6S3P9meonG3niaedpo3g';`
  PHP source doesn't leak via HTTP (it executes), but the key is in git history and on
  every machine with the repo. Fix during Layer 3: remove the fallback (fail loudly if
  .env missing) + rotate the Resend key.

## 3. Also check while in there (quick audits, same session)

- [ ] Lead Scrapper (`leadscrapper.pixnom.com`): does it serve any secret-bearing file?
      (`.env` in web root? `lib/*.php` is fine — PHP executes, doesn't print source —
      but check for `.env`, `*.log`, `dist.zip`, `supabase_save.log` in web root.)
      → `curl https://leadscrapper.pixnom.com/.env` etc.
- [ ] `git log --all -- config.js` in MW repo: secrets are in git history too — if repo
      is/goes public anywhere (GitHub), history must be scrubbed or keys rotated (Layer 3
      covers rotation, which is the practical answer).
- [ ] Firebase rules for `apify-data-19ca2` project: web key is public by design, but
      verify Firestore/Storage rules don't allow open writes.

---

## 4. Open Questions (ask sir when starting this work)

1. Map2Web path on VPS + how the Node server runs (pm2? systemd? port?)
2. Confirm `sheetsCreditUrl` (Google Apps Script URL) — read-only or does it mutate credits? If mutating, move server-side.
3. Exposure window — when was the white-UI version first deployed? (Determines how long keys were public; check billing for that period.)
