# Integration Roadmap — Map2Web Email Writer + Leadscrapper into app.pixnom.com

This plan is based on the **actual** Map2Web integration pattern documented in
`D:\map2web.pixnom.com_2026-04-09_23_31_04\map2web.pixnom.com_whiteUI\INTEGRATION_SOP.md`.

---

## How Map2Web is integrated (the real pattern)

It's a **hybrid**, not a full port:

| Layer | Lives in | What it does |
|---|---|---|
| Sidebar link | Makerkit (`personal-account-navigation.config.tsx`) | One entry per feature |
| Dashboard pages (`/home/map2web/*`) | Makerkit (Next.js `page.tsx`) | Reads Supabase tables directly via admin client, shows credits + history |
| Sub-pages (history, emailwriter) | Makerkit | Plain Next.js pages — Email Writer is a stub today |
| Standalone scraping/generation app | Separate Node/Express server on port 4000 at `map2web.pixnom.com` | The original Vanilla JS app, untouched |
| Database | Supabase tables `user_credits` + `user_data` | Shared between Makerkit dashboard and standalone app |
| Auth bridge | Email-based (Supabase auth email = `user_credits.Email` column) | OTP flow on standalone, cookie auth on Makerkit |

**Implication**: We do NOT need to port the React Leadscrapper UI into Makerkit. The pattern is: deploy Leadscrapper standalone on the VPS, add a Makerkit dashboard page that reads its data from a new Supabase table, link out.

---

## Part 1 — Map2Web Email Writer (pending)

The placeholder is at:
`/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/map2web/emailwriter/page.tsx`

It says: *"Porting the 5 email script templates from the standalone app."*

Those 5 templates live in:
`D:\map2web.pixnom.com_2026-04-09_23_31_04\map2web.pixnom.com_whiteUI\app.js`

### Plan
1. Open the standalone `app.js`, search for the 5 template strings (look for `template`, `script`, or the variable that holds them — `grep -n "template" app.js` shows 60 matches).
2. Extract the 5 templates + the variable-substitution logic (likely `{{businessName}}`, `{{phone}}` placeholders).
3. Build the Email Writer Next.js page with this UX:
   - Dropdown: pick from the user's `user_data` rows (their generated sites).
   - Dropdown: pick one of 5 templates.
   - Live preview of the substituted email body.
   - Copy-to-clipboard button (Phase 1).
   - Phase 2 (optional): "Send via Resend" — RESEND_API_KEY already exists.
4. No new Supabase tables needed. The data sources (`user_data`) already exist.

### Files to create/modify in Makerkit
- **Modify**: `apps/web/app/[locale]/home/(user)/map2web/emailwriter/page.tsx` (replace stub).
- **Create**: `apps/web/lib/map2web/email-templates.ts` (the 5 templates as TS constants).
- **Optional create**: `apps/web/app/api/map2web/send-email/route.ts` if Phase 2 send-via-Resend is wanted.

### Rebuild command (same as map2web integration)
```bash
cd /root/next-supabase-saas-kit-turbo-main && pnpm build && pm2 restart makerkit
```

### Effort: ~4–8 hours

---

## Part 2 — Leadscrapper integration (the hybrid pattern)

Mirror exactly what was done for Map2Web. **Do NOT rewrite Leadscrapper in Next.js** — keep it as a standalone app and link out, just like Map2Web does.

### Architecture target

```
app.pixnom.com (Makerkit)
├── Sidebar: "Leadscrapper" → links to https://leadscrapper.pixnom.com (or /home/leadscrapper)
├── /home/leadscrapper/page.tsx        → dashboard (credits + recent searches)
├── /home/leadscrapper/history/page.tsx → past searches list
└── /home/leadscrapper/leads/page.tsx   → saved leads table

leadscrapper.pixnom.com (Standalone, on VPS port 5000 or similar)
├── The React+Vite+PHP app from D:\Lead Scrapper PROD\
├── apify-proxy.php (with cache layer we just built)
├── extract-email.php, sheets-proxy.php, etc.
└── Reads/writes Supabase tables for credits + history
```

### Phase A — Backend on VPS (the standalone app)

1. **SSH to VPS** and create a new pm2 process slot — pick a port (e.g., 5000):
   ```bash
   mkdir /var/www/leadscrapper.pixnom.com
   ```
2. **SCP the project** from `D:\Lead Scrapper PROD\` to that folder. Include:
   - All `.js`, `.html`, `.css`, `.php` files
   - `components/`, `utils/`, `niche/` (if any)
   - `package.json`, `vite.config.js`
   - Do NOT copy `node_modules`, `dist`, `.git`, `.env` (recreate `.env` on the server with prod Apify keys)
3. **Build the frontend** on the server:
   ```bash
   cd /var/www/leadscrapper.pixnom.com
   npm install
   npm run build
   ```
4. **Configure Apache or Nginx** to serve PHP from this folder. The map2web SOP shows Makerkit is on port 3000 behind nginx — Leadscrapper PHP needs PHP-FPM. Add an nginx vhost:
   ```nginx
   server {
     server_name leadscrapper.pixnom.com;
     root /var/www/leadscrapper.pixnom.com/dist;  # Vite build output
     index index.html;
     location / { try_files $uri /index.html; }
     location ~ \.php$ {
       root /var/www/leadscrapper.pixnom.com;
       fastcgi_pass unix:/run/php/php8.x-fpm.sock;
       include fastcgi_params;
       fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
     }
   }
   ```
5. **Create `.env` on the server** with the production Apify keys (do not commit, use `scp`).
6. **DNS**: point `leadscrapper.pixnom.com` to the VPS IP.
7. **SSL**: `certbot --nginx -d leadscrapper.pixnom.com`.

### Phase B — Connect to Supabase (replace the JSON cache + add credits/history)

This is the part that needs the most work and mirrors map2web's `SupabaseController.js` pattern.

1. **Create new Supabase tables**. Run this in Supabase SQL editor:
   ```sql
   create table public.leadscrapper_searches (
     id uuid primary key default gen_random_uuid(),
     email text not null,
     keyword text not null,
     location text not null,
     requested_count int not null,
     served_from_cache boolean not null default false,
     credits_charged int not null default 0,
     created_at timestamptz not null default now()
   );

   create table public.leadscrapper_query_cache (
     cache_key text primary key,            -- "plumbers|denver"
     places jsonb not null,                 -- array of Apify places, deduped by placeId
     scraped_at timestamptz not null default now()
   );

   create table public.leadscrapper_saved_leads (
     id uuid primary key default gen_random_uuid(),
     email text not null,
     place_id text,
     business_name text,
     phone text,
     email_address text,
     website text,
     category text,
     score numeric,
     raw_data jsonb,
     created_at timestamptz not null default now(),
     unique (email, place_id)
   );
   ```
2. **Refactor `apify-proxy.php`** to use Supabase instead of `.apify_cache.json`:
   - Replace `loadCache()` / `saveCache()` with HTTP calls to Supabase REST API using the service-role key.
   - Replace `.apify_key_state.json` with a `leadscrapper_state` table OR keep it as a file (simpler, OK on a single VPS).
   - Best practice: build a small PHP helper `lib/supabase.php` mirroring map2web's `server/lib/supabase.js`.
3. **Charge credits**: on every cache-miss Apify run, call Supabase to decrement `user_credits.Credits` by N (where N = price per result). Cache hits = 0 credits charged. Mirror map2web's `deductCredit` controller.
4. **Log every search** to `leadscrapper_searches` so the Makerkit dashboard can show history.

### Phase C — Makerkit-side Leadscrapper pages (the dashboard)

Mirror exactly what map2web's `/home/map2web/page.tsx` does. Create:

1. **Sidebar entry** in `personal-account-navigation.config.tsx`:
   ```tsx
   {
     label: 'Leadscrapper',
     path: 'https://leadscrapper.pixnom.com',
     Icon: <Search className={iconClasses} />,
   }
   ```
   (Or, if you want it embedded under `/home/leadscrapper`, use `path: '/home/leadscrapper'` and create the page.)

2. **Create dashboard page** at:
   `apps/web/app/[locale]/home/(user)/leadscrapper/page.tsx`

   Copy the structure of map2web's dashboard. Show:
   - Token Balance card (reads `user_credits.Credits` for the logged-in email, with DEV MODE for `DEV_EMAILS`).
   - Total Usage card (count of rows in `leadscrapper_searches`).
   - Recent Activity table (joins `leadscrapper_searches` to show last 10 searches with keyword, location, count, cache-hit badge, date).

3. **History sub-page**: `apps/web/app/[locale]/home/(user)/leadscrapper/history/page.tsx` — full paginated list.

4. **Saved Leads sub-page**: `apps/web/app/[locale]/home/(user)/leadscrapper/leads/page.tsx` — table from `leadscrapper_saved_leads`.

5. Use the same `getAdminClient()` pattern from the map2web SOP (with `SUPABASE_SECRET_KEY` to bypass RLS).

6. **Rebuild Makerkit**:
   ```bash
   cd /root/next-supabase-saas-kit-turbo-main && pnpm build && pm2 restart makerkit
   ```

### Phase D — Auth bridge (so credits work)

Leadscrapper standalone needs to know which user is logged in. Two options:

**Option 1 — Email-based (matches map2web pattern)**
- Leadscrapper has its own OTP login (we already have `send-otp.php`).
- Once logged in on `leadscrapper.pixnom.com`, the email is stored in localStorage and sent with every Apify request.
- The PHP backend reads the email from request body, looks up credits in Supabase. Same flow as map2web's standalone.

**Option 2 — SSO via Supabase**
- More elegant but more work. Skip for v1.

Recommendation: **Option 1**. Replicate map2web's pattern exactly.

---

## What to do TODAY vs LATER

### Today (low-risk, valuable)
1. Finish the Email Writer for Map2Web. It's a self-contained 4–8h task using templates that already exist.
2. Keep testing the local Leadscrapper cache fix we just built.

### Next (sequential, when ready)
3. Phase A: deploy Leadscrapper standalone to VPS at `leadscrapper.pixnom.com`. (~1 day)
4. Phase B: wire it to Supabase for credits + history + cache. (~1–2 days)
5. Phase C: build the Makerkit dashboard pages. (~1 day)
6. Phase D: add OTP login + credit deduction. (~1 day)

**Total: ~5–7 working days** for a polished, billing-integrated, hybrid integration matching the Map2Web pattern.

---

## Files I need to inspect on the VPS to write the actual code

When you're ready to implement, give me access to (or paste) these from the VPS:

1. `/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/map2web/page.tsx` (the working dashboard pattern)
2. `/root/next-supabase-saas-kit-turbo-main/apps/web/config/personal-account-navigation.config.tsx` (sidebar)
3. `/var/www/map2web-or-wherever/server/lib/supabase.js` and `server/controllers/SupabaseController.js` (the credit deduction pattern)
4. `/etc/nginx/sites-enabled/makerkit` and any other nginx vhost (to understand the routing)

Without those, I'd be writing code blind. With them, I can produce drop-in files.
