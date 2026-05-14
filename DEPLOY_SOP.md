# Leadscrapper — Deploy SOP

Deploy `D:\Lead Scrapper PROD\` as a standalone app at `leadscrapper.pixnom.com`,
mirroring the Map2Web hosting pattern (same VPS, separate nginx vhost).

**Scope**: No credit system, no login, no Supabase. Pure file-based cache.
Anyone with the URL can use the tool.

---

## Part 1 — On your Windows machine

### 1.1 Build the production bundle

In a terminal at `D:\Lead Scrapper PROD\`:

```bash
npm install            # only if you haven't already
npm run build
```

This produces `D:\Lead Scrapper PROD\dist\` containing:
- `index.html`, `assets/*` (compiled React bundle)
- `apify-proxy.php`, `extract-email.php`, `sheets-proxy.php`, `shorten-url.php`, `send-otp.php`
- `.env` (copied automatically by `copy-php` script)

> ⚠️ **The build copies `.env` into `dist/`.** Make sure the Apify keys in
> `D:\Lead Scrapper PROD\.env` are the **production** keys before building.
> Or build with placeholder values and replace `dist/.env` manually after upload.

### 1.2 Package for upload

Zip the `dist/` folder OR just SCP it directly. Example with SCP from PowerShell:

```powershell
scp -r "D:\Lead Scrapper PROD\dist" root@YOUR_VPS_IP:/var/www/leadscrapper.pixnom.com
```

(Replace `YOUR_VPS_IP` with the actual IP. Or use WinSCP/FileZilla if you prefer GUI.)

---

## Part 2 — On the VPS (SSH session)

### 2.1 Confirm prerequisites

```bash
# PHP-FPM must be installed (same one map2web uses)
php-fpm -v
systemctl status php8.2-fpm    # or whatever version is installed

# Nginx must be running
systemctl status nginx
```

If PHP-FPM is missing:
```bash
apt update && apt install -y php-fpm php-curl
```

### 2.2 Place the files (if you didn't SCP directly to the final path)

```bash
mkdir -p /var/www/leadscrapper.pixnom.com
# Unzip OR move uploaded files into this folder
# Final layout should be:
#   /var/www/leadscrapper.pixnom.com/index.html
#   /var/www/leadscrapper.pixnom.com/assets/
#   /var/www/leadscrapper.pixnom.com/apify-proxy.php
#   /var/www/leadscrapper.pixnom.com/.env
#   ...etc

chown -R www-data:www-data /var/www/leadscrapper.pixnom.com
chmod 640 /var/www/leadscrapper.pixnom.com/.env   # protect API keys
```

### 2.3 Create the nginx vhost

```bash
nano /etc/nginx/sites-available/leadscrapper.pixnom.com
```

Paste this config (adjust `php8.2-fpm.sock` to whatever PHP-FPM version is on the box):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name leadscrapper.pixnom.com;

    root /var/www/leadscrapper.pixnom.com;
    index index.html;

    # Protect .env and other dotfiles
    location ~ /\. {
        deny all;
        return 404;
    }

    # Protect the cache + state JSON files (server-side only)
    location ~ /\.apify_cache\.json|\.apify_key_state\.json {
        deny all;
        return 404;
    }

    # PHP files — handled by PHP-FPM
    location ~ \.php$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }

    # SPA fallback — all other routes serve index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Reasonable caching for static assets
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

Enable + test + reload:

```bash
ln -s /etc/nginx/sites-available/leadscrapper.pixnom.com /etc/nginx/sites-enabled/
nginx -t                           # must say "syntax is ok"
systemctl reload nginx
```

### 2.4 DNS

In your DNS provider, add an **A record**:
- Host: `leadscrapper`
- Value: your VPS public IP
- TTL: default

Wait 1–5 min for propagation. Verify:
```bash
dig leadscrapper.pixnom.com +short    # should return your VPS IP
```

### 2.5 SSL via Certbot

```bash
certbot --nginx -d leadscrapper.pixnom.com
```

Follow the prompts; pick "redirect HTTP to HTTPS". Certbot auto-edits the nginx config to add the SSL block + redirect.

### 2.6 Verify

Open in browser:
1. **`https://leadscrapper.pixnom.com/apify-proxy.php?action=status`**
   - Should return JSON like `{"totalKeys":1,"currentIndex":0,...}`
   - If 502/500: check `tail -f /var/log/nginx/error.log` and `journalctl -u php8.2-fpm`
   - If `{"totalKeys":0}`: the .env wasn't uploaded or PHP-FPM can't read it (permissions)

2. **`https://leadscrapper.pixnom.com/`**
   - Should load the Leadscrapper UI.

3. Run a search end-to-end. Confirm cache works:
   - `https://leadscrapper.pixnom.com/apify-proxy.php?action=cache` shows the entry.
   - Repeat the same search at smaller count → "served from cache, no API credits used".

---

## Part 3 — Add the Makerkit sidebar link

(Same pattern as Map2Web integration SOP, section 1–4.)

### 3.1 Edit the navigation config

```bash
nano /root/next-supabase-saas-kit-turbo-main/apps/web/config/personal-account-navigation.config.tsx
```

Add `Search` to the lucide imports at the top:
```tsx
import { CreditCard, Home, User, LayoutTemplate, Search } from 'lucide-react';
```

In the `children` array under `common.routes.application` (around line 20, right after the Map2Web entry), insert:

```tsx
      {
        label: 'Leadscrapper',
        path: 'https://leadscrapper.pixnom.com',
        Icon: <Search className={iconClasses} />,
      },
```

Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

### 3.2 Rebuild Makerkit

```bash
cd /root/next-supabase-saas-kit-turbo-main
pnpm build
pm2 restart makerkit
```

### 3.3 Verify

Visit `https://app.pixnom.com/home` — you should see a new "Leadscrapper" entry in the sidebar. Clicking it opens `leadscrapper.pixnom.com` in the same tab (or new tab — depends on Makerkit's link behavior; map2web uses the same `path:` external URL pattern).

---

## Part 4 — Troubleshooting

### 502 Bad Gateway
- Wrong PHP-FPM socket path. Run `ls /var/run/php/` to see what's there, update nginx config.
- PHP-FPM not running. `systemctl restart php8.2-fpm`.

### CORS error in browser console
- The app and proxy are same-origin (`leadscrapper.pixnom.com`), so this shouldn't happen.
- If it does, check that `LeadSearch.js` doesn't hardcode `localhost:8000` in production (it shouldn't — the conditional in the file handles this).

### Cache file not being created
- Permissions: `chown -R www-data:www-data /var/www/leadscrapper.pixnom.com`
- The cache file (`.apify_cache.json`) is created on first cache write. Until then it doesn't exist — that's normal.
- Verify with: `curl https://leadscrapper.pixnom.com/apify-proxy.php?action=cache` — if it errors, check `tail -f /var/log/nginx/error.log`.

### Apify says "invalid token"
- The `.env` on the VPS still has the local/expired key.
- SCP the production `.env` and restart PHP-FPM: `systemctl restart php8.2-fpm`.

### Sidebar link not showing after Makerkit rebuild
- `pnpm build` failed silently. Check the build output for errors.
- File encoding: must be UTF-8 (per map2web SOP). If you edited on Windows and uploaded, save as UTF-8 without BOM.

---

## Part 5 — Quick reference (commands you'll run again later)

```bash
# Update Leadscrapper (after code changes locally)
# On Windows:
npm run build
scp -r dist/* root@VPS:/var/www/leadscrapper.pixnom.com/

# On VPS:
chown -R www-data:www-data /var/www/leadscrapper.pixnom.com
# No restart needed — PHP/nginx pick up changes instantly

# Inspect cache state
curl https://leadscrapper.pixnom.com/apify-proxy.php?action=cache | jq

# Clear cache (forces fresh scrapes)
curl "https://leadscrapper.pixnom.com/apify-proxy.php?action=cache&op=clear"

# Check active API key
curl https://leadscrapper.pixnom.com/apify-proxy.php?action=status
```

---

## Part 5b — Supabase migration (replaces Google Sheets)

Storage moved off the Google Apps Script + Sheets backend onto Supabase project
`fnevhniqvchvxwkqzjzg`. The frontend now calls `leads-proxy.php` (server-side,
service-role key) instead of `sheets-proxy.php`.

### 5b.1 Schema

The table already exists: `public.leadscrapper_leads_data` with PascalCase
columns matching the legacy Google Sheet header 1:1 (Title, Price, …,
PlaceId, UserEmail, LeadScore, Status, Notes, Issues, CreatedAt, …).
Composite uniqueness on `(UserEmail, PlaceId)` is required for upserts to
work — verify in Supabase Table editor → Indexes if upserts fail.

### 5b.2 Production .env (on VPS, NOT in git)

```
SUPABASE_URL="https://fnevhniqvchvxwkqzjzg.supabase.co"
SUPABASE_SERVICE_KEY="<service-role JWT>"
```

After editing `.env` on the VPS:
```bash
chmod 640 /var/www/leadscrapper.pixnom.com/.env
chown www-data:www-data /var/www/leadscrapper.pixnom.com/.env
systemctl reload php8.2-fpm   # PHP-FPM caches env reads in some setups
```

### 5b.3 Verify

```bash
curl 'https://leadscrapper.pixnom.com/leads-proxy.php?action=load&email=test@example.com'
# Expect: {"success":true,"leads":[],"emails":[],"reports":[]}
```

If you see `SUPABASE_URL or SUPABASE_SERVICE_KEY missing in .env`, the `.env`
wasn't copied or PHP-FPM can't read it (permissions).

### 5b.4 Rollback

If something breaks, revert the GAS_URL call site in `app.jsx` (one block at
the top) and rebuild. The old `sheets-proxy.php` and `Code.gs` are still
checked in.

---

## What we did NOT set up (deferred)

These are all optional. If you want them later:

| Feature | What it would take |
|---|---|
| OTP login | Already coded in `send-otp.php` — needs to be wired in `app.js`. ~2h. |
| Credit system | Add Supabase tables + decrement on each search. Mirror map2web pattern. ~6h. |
| Per-user history | Same Supabase work as credits. ~2h on top. |
| Makerkit dashboard page showing search history | Next.js page reading from Supabase. ~3h. |

For now: ship the public version. Add billing later if usage grows.

---

## Part 6 — Phase A: Makerkit In-App Integration

This section deploys the `makerkit-leadscrapper/` folder so Leadscrapper lives
**inside** the Makerkit app with its own sidebar (same pattern as Map2Web),
rather than opening an external URL.

### 6.1 Upload the folder (from Windows)

Using WinSCP or SCP, copy the entire `makerkit-leadscrapper/` folder to the
Makerkit app directory on the VPS:

```powershell
# From PowerShell on your Windows machine:
scp -r "D:\Lead Scrapper PROD\makerkit-leadscrapper" root@YOUR_VPS_IP:/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/leadscrapper
```

> ⚠️ **Important**: The target folder name is `leadscrapper` (no `makerkit-` prefix).
> The `[locale]` and `(user)` folders use literal bracket/paren characters in the path —
> this is Next.js dynamic route syntax. The path already exists on the VPS from the
> Map2Web setup.

**Final VPS layout** should be:
```
/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)/leadscrapper/
├── layout.tsx
├── page.tsx                          ← redirects to /home/leadscrapper/find-leads
├── _components/
│   └── leadscrapper-sidebar.tsx      ← 9-item sidebar
├── find-leads/
│   └── page.tsx                      ← iframe of leadscrapper.pixnom.com
├── dashboard/
│   └── page.tsx                      ← "Coming soon" stub
├── lead-manager/
│   └── page.tsx
├── ai-email-writer/
│   └── page.tsx
├── pdf-reports/
│   └── page.tsx
├── review-responder/
│   └── page.tsx
├── post-creator/
│   └── page.tsx
├── email-outreach/
│   └── page.tsx
└── settings/
    └── page.tsx
```

### 6.2 Edit the Makerkit navigation config (on VPS)

```bash
nano /root/next-supabase-saas-kit-turbo-main/apps/web/config/personal-account-navigation.config.tsx
```

Find the existing Leadscrapper entry and change the `path` from the external URL
to the internal route:

```diff
       {
         label: 'Leadscrapper',
-        path: 'https://leadscrapper.pixnom.com',
+        path: '/home/leadscrapper/find-leads',
         Icon: <Search className={iconClasses} />,
       },
```

> **Note**: Keep it as a single entry — NOT a dropdown. The in-page sidebar
> (leadscrapper-sidebar.tsx) provides the sub-navigation, same as Map2Web.

Save: `Ctrl+O`, `Enter`, `Ctrl+X`.

### 6.3 Rebuild and restart Makerkit

```bash
cd /root/next-supabase-saas-kit-turbo-main
pnpm build        # must succeed — no new dependencies needed
pm2 restart web   # or: pm2 restart makerkit (whichever process name is used)
```

If `pnpm build` fails, check:
- The `Search` icon import from lucide-react is still in place (added in a prior session).
- No stray Windows line endings — run `dos2unix` on the uploaded files if needed:
  ```bash
  find /root/next-supabase-saas-kit-turbo-main/apps/web/app/\\[locale\\]/home/\\(user\\)/leadscrapper -name '*.tsx' -exec dos2unix {} +
  ```

### 6.4 Verify (8-point checklist)

1. **`app.pixnom.com/home/leadscrapper/find-leads`** — Shows the in-app sidebar
   on the left (9 items) and the live Leadscrapper iframe on the right.
2. **Click each of the other 8 sidebar items** — Each route resolves and shows
   the page title + "Coming soon" card.
3. **Click the main Makerkit "Leadscrapper" sidebar entry** — Should route to
   `/home/leadscrapper/find-leads` (no external redirect, stays in the app).
4. **`app.pixnom.com/home/leadscrapper`** (bare path) — Should auto-redirect to
   `/home/leadscrapper/find-leads`.
5. **Caching works**: Search "plumbers + denver, 30" inside the iframe, then
   search again — second run should be instant (served from cache).
6. **Active-link highlight**: The sidebar item for the current page should be
   highlighted (bg-primary/10 text-primary).
7. **No console errors** — Open DevTools, confirm no 404s or import failures.
8. **External site still works** — `leadscrapper.pixnom.com` is still accessible
   independently (the iframe points to it).
