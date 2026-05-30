# UI Redesign + Makerkit Top Navbar Deployment

**Date:** 2026-05-26
**Scope:** Two surfaces touched in one session
1. **Standalone React app** (`leadscrapper.pixnom.com`, served from `/var/www/leadscrapper.pixnom.com`) — search-input redesign + dev-mode TopNavbar
2. **Makerkit Next.js app** (`app.pixnom.com`, runs as pm2 process `makerkit`) — global top bar above every `/home/(user)/*` page, notifications bell removed

---

## Part A — Standalone React App Changes

### A1. Installed `country-state-city` for cascading location dropdowns
```bash
cd "D:\Lead Scrapper PROD"
npm install country-state-city --save
```
Replaces the hardcoded `utils/indiaData.js` (India-only) with the world dataset.

### A2. New file `components/TopNavbar.jsx`
Horizontal bar with:
- Logo (Leadscrapper / Zap icon)
- **Services ▾** dropdown — Map2Web / LeadScrapper / Uptime (all link to `app.pixnom.com/home/...`)
- **Plans & Pricing** link → `https://app.pixnom.com/home/billing`
- Orange credits bar + `N Credits left` + **Upgrade** button (→ billing URL)
- **Need Help? ▾** dropdown (Contact Support, Billing)
- 🌐 EN language indicator (static)
- Avatar circle (user initial) + dropdown (email shown, Billing link, Log Out)
- **No notification bell**

Only shows when `!isEmbed` (i.e. standalone or dev — hidden when loaded via iframe in Makerkit).

### A3. Mounted navbar in `app.jsx`
- Added `import TopNavbar from './components/TopNavbar.jsx'`
- Lifted `balance` state up from `LeadSearch.jsx` to `App` so navbar + LeadSearch share one source
- Added shared `refreshBalance()` callback (passed down to LeadSearch as `onRefreshBalance`)
- Layout reshaped to `flex-row [Sidebar] [flex-col [TopNavbar] [main]]`

### A4. Refactored `components/LeadSearch.jsx`
**Before:** 6-field grid (Keyword / Country / State / City / ZIP / Search)

**After:** Sentence-style composer
- Country dropdown at top-left of the card, defaults to **US**
- Sentence row: 🔍 *I'm looking for* `[Profession]` *in* `[State / Province]`, `[City]`, `[ZIP / PIN]` + Search button
- Internal state now holds **ISO codes** (`country='US'`, `selectedState='CA'`); display name resolved via `country-state-city`
- Country code passed to Apify proxy unchanged at `requestBody.countryCode = country.toLowerCase()`
- In-card credits display removed (now lives in navbar)
- Accepts `balance` + `onRefreshBalance` props

### A5. Enter-to-next-field navigation
- Made `components/SearchableDropdown.jsx` a `forwardRef` component exposing `focus()` and `open()` imperative methods
- Refs added in LeadSearch (`keywordRef`, `stateRef`, `cityRef`, `zipRef`)
- Flow: Enter in Profession → focus + open State; selecting State → focus + open City; selecting City → focus ZIP; Enter in ZIP → trigger Search

### A6. Cleanup
- Deleted `utils/indiaData.js` (no longer imported by any active code)

---

## Part B — Makerkit (`app.pixnom.com`) Production Changes

### B1. Server setup recap (where things live)
- **Repo:** `/root/next-supabase-saas-kit-turbo-main/`
- **Next.js app:** `apps/web/` (TypeScript, App Router)
- **pm2 process:** `makerkit` (id 6), runs `npm start` from `apps/web/`
- **Node:** `/root/.nvm/versions/node/v20.18.0/bin/{node,pnpm,pm2}`
- **Build command:** `pnpm build` from `apps/web/` (≈19s)
- **Restart command:** `pm2 restart makerkit --update-env`

### B2. Notification bell — disabled via env flag
**File:** `apps/web/.env.production.local`
**Appended:**
```ini
# Disable notifications bell (added 2026-05-26)
NEXT_PUBLIC_ENABLE_NOTIFICATIONS=false
NEXT_PUBLIC_REALTIME_NOTIFICATIONS=false
```

**Why this works:** Both `_components/home-sidebar.tsx` and `_components/home-menu-navigation.tsx` already wrap `<UserNotifications />` in `<If condition={featuresFlagConfig.enableNotifications}>`. Flipping the flag removes the bell with zero code changes. `NEXT_PUBLIC_*` variables are inlined at build time, so a rebuild is required for changes to take effect.

**Backup:** `.env.production.local.bak.20260526-092154`

### B3. New file — `_components/services-dropdown.tsx`
**Path:** `apps/web/app/[locale]/home/(user)/_components/services-dropdown.tsx`
**Type:** Client component (`'use client'`)
**Renders:** Services ▾ dropdown using Tailwind + Lucide chevron. Items:
- Map2Web → `/home/map2web/home`
- LeadScrapper → `/home/leadscrapper/dashboard`
- Uptime → `/home/uptime`

Uses `useRef` + `mousedown` outside-click handler to close.

### B4. New file — `_components/leadscrapper-top-bar.tsx`
**Path:** `apps/web/app/[locale]/home/(user)/_components/leadscrapper-top-bar.tsx`
**Type:** Server component (async)

**Server-side credit fetch:** Reads `user_credits.Credits` keyed by `Email` (case-insensitive `ilike`) using `getSupabaseServerAdminClient()`. Mirrors the logic in `apps/web/app/api/supabase/credits/get/route.ts`. Returns `null` on error or missing user.

**Renders:**
- Services ▾ (client island)
- Plans & Pricing link → `/home/billing`
- Spacer
- Orange credits bar (proportional fill up to `CREDITS_MAX = 1000` visual cap)
- `N Credits left` text
- Upgrade button → `/home/billing`

Tailwind classes use Makerkit-native tokens (`bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`, `text-primary-foreground`) so it inherits the theme automatically.

### B5. Modified file — `layout.tsx`
**Path:** `apps/web/app/[locale]/home/(user)/layout.tsx`
**Backup:** `layout.tsx.bak.20260526-092719`

**Changes:**
1. Added import: `import { LeadscrapperTopBar } from './_components/leadscrapper-top-bar';`
2. In **both** `SidebarLayout` and `HeaderLayout`, wrapped `{children}` with a flex column containing the top bar:
   ```tsx
   <div className="flex flex-1 flex-col min-w-0">
     <LeadscrapperTopBar />
     {children}
   </div>
   ```
3. Why a `<div>` wrapper? Makerkit's `<Page>` component uses a slot pattern (`getSlotsFromPage`) that scans direct children for specific component types (`PageNavigation`, `PageMobileNavigation`). The last "other" child wins as the main content slot. Wrapping bar + `{children}` in one `<div>` ensures both render together inside the slot.

### B6. Build + restart sequence
```bash
ssh root@74.208.208.186

# Build (background, log to /tmp)
cd /root/next-supabase-saas-kit-turbo-main/apps/web
PATH=/root/.nvm/versions/node/v20.18.0/bin:$PATH
nohup bash -c "pnpm build > /tmp/makerkit-build.log 2>&1; echo EXIT_CODE=\$? >> /tmp/makerkit-build.log" </dev/null >/dev/null 2>&1 & disown

# Tail until done
tail -f /tmp/makerkit-build.log
# Wait for "EXIT_CODE=0" or "Compiled successfully"

# Restart pm2 with new env
pm2 restart makerkit --update-env
pm2 logs makerkit --lines 20 --nostream
```

**Result:** `✓ Compiled successfully in 19.0s`, `Ready in 100ms`, no new errors. Credits lookup verified in pm2 logs:
```
[Credits] Found user shreyashchandak321@gmail.com: 1000 credits.
```

---

## How to Re-Enable the Notifications Bell

Two ways, depending on whether you want it back permanently or just toggle it:

### Option 1 — Edit env file (recommended)
```bash
ssh root@74.208.208.186
cd /root/next-supabase-saas-kit-turbo-main/apps/web

# Edit the file
nano .env.production.local
# Change these two lines:
#   NEXT_PUBLIC_ENABLE_NOTIFICATIONS=false   →   true
#   NEXT_PUBLIC_REALTIME_NOTIFICATIONS=false →   true (optional; only needed for realtime push)

# OR overwrite via sed:
sed -i 's/NEXT_PUBLIC_ENABLE_NOTIFICATIONS=false/NEXT_PUBLIC_ENABLE_NOTIFICATIONS=true/' .env.production.local
sed -i 's/NEXT_PUBLIC_REALTIME_NOTIFICATIONS=false/NEXT_PUBLIC_REALTIME_NOTIFICATIONS=true/' .env.production.local

# Rebuild + restart (required — NEXT_PUBLIC_* is inlined at build time)
PATH=/root/.nvm/versions/node/v20.18.0/bin:$PATH
pnpm build && pm2 restart makerkit --update-env
```

### Option 2 — Restore from backup
```bash
ssh root@74.208.208.186
cd /root/next-supabase-saas-kit-turbo-main/apps/web

# Replace current env with pre-change backup
cp .env.production.local .env.production.local.before-renotify-$(date +%Y%m%d-%H%M%S)
cp .env.production.local.bak.20260526-092154 .env.production.local

# Rebuild + restart
PATH=/root/.nvm/versions/node/v20.18.0/bin:$PATH
pnpm build && pm2 restart makerkit --update-env
```

**Verify:** After restart, visit `https://app.pixnom.com/home/leadscrapper/dashboard`. The bell icon should reappear in the top-right of the left sidebar header. If you also enabled realtime, supabase realtime channel for `notifications` will start subscribing.

---

## How to Fully Roll Back the Top Bar (Emergency)

If the top bar breaks something and you need it gone fast:

```bash
ssh root@74.208.208.186
BASE='/root/next-supabase-saas-kit-turbo-main/apps/web/app/[locale]/home/(user)'

# Restore layout.tsx
cp "$BASE/layout.tsx.bak.20260526-092719" "$BASE/layout.tsx"

# Remove the new components
rm "$BASE/_components/leadscrapper-top-bar.tsx"
rm "$BASE/_components/services-dropdown.tsx"

# Rebuild + restart
cd /root/next-supabase-saas-kit-turbo-main/apps/web
PATH=/root/.nvm/versions/node/v20.18.0/bin:$PATH
pnpm build && pm2 restart makerkit --update-env
```

Site is restored to the previous design within ~30s of build completion.

---

## How to Modify the Top Bar (Common Tweaks)

### Change the credits bar visual cap (default: 1000)
File: `apps/web/app/[locale]/home/(user)/_components/leadscrapper-top-bar.tsx`
Line: `const CREDITS_MAX = 1000;`

### Change/add Services dropdown items
File: `apps/web/app/[locale]/home/(user)/_components/services-dropdown.tsx`
Edit the `SERVICES` array at the top.

### Change Upgrade / Plans & Pricing destination
File: `apps/web/app/[locale]/home/(user)/_components/leadscrapper-top-bar.tsx`
Line: `const BILLING_URL = '/home/billing';`

### Hide the bar on a specific page
Move the bar OUT of `(user)/layout.tsx` and INTO a more specific layout (e.g. `(user)/leadscrapper/layout.tsx`). Currently it's at `(user)/layout.tsx` so it renders for **every** logged-in home page.

### Show bar only on leadscrapper pages
1. Remove the `<LeadscrapperTopBar />` + wrapper `<div>` from `(user)/layout.tsx`
2. Edit `(user)/leadscrapper/layout.tsx`:
   ```tsx
   import { LeadscrapperTopBar } from '../_components/leadscrapper-top-bar';

   export default function LeadscrapperLayout({ children }: { children: React.ReactNode }) {
     return (
       <div className="flex flex-1 flex-col min-w-0">
         <LeadscrapperTopBar />
         {children}
       </div>
     );
   }
   ```
3. Rebuild + restart.

---

## File Index — Quick Reference

### Standalone React app (`D:\Lead Scrapper PROD\`)
| File | Status |
|------|--------|
| `package.json` | dep added: `country-state-city` |
| `app.jsx` | mount TopNavbar, lift balance state |
| `components/TopNavbar.jsx` | **NEW** |
| `components/LeadSearch.jsx` | sentence-style refactor, ISO codes, ref-based Enter nav |
| `components/SearchableDropdown.jsx` | now `forwardRef`, exposes `focus()`/`open()` |
| `utils/indiaData.js` | **DELETED** |
| `_makerkit-staging/` | local staging dir, only for reviewing Makerkit edits before scp |

### Makerkit (`/root/next-supabase-saas-kit-turbo-main/apps/web/`)
| File | Status | Backup |
|------|--------|--------|
| `.env.production.local` | added 2 lines | `.env.production.local.bak.20260526-092154` |
| `app/[locale]/home/(user)/layout.tsx` | top bar mounted in both layouts | `layout.tsx.bak.20260526-092719` |
| `app/[locale]/home/(user)/_components/leadscrapper-top-bar.tsx` | **NEW** | — |
| `app/[locale]/home/(user)/_components/services-dropdown.tsx` | **NEW** | — |

---

## Security Notes

⚠️ **The SSH password was shared via chat during this session** and was cached locally at `~/.ssh/pixnom-pass` (chmod 600) to avoid retyping it during the deploy.

**Action items:**
1. Run `passwd` on the VPS to set a new SSH password
2. Delete the local cache: `rm ~/.ssh/pixnom-pass`
3. Consider switching to SSH key auth and disabling password auth in `/etc/ssh/sshd_config` (`PasswordAuthentication no`)
