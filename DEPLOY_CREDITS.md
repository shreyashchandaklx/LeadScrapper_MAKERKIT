# Credit System — Deploy Steps

The leadscrapper now shares the **same `user_credits` balance** that map2web uses.
Pricing: **1 credit = 100 leads** (0.01 credit per lead). Leftover leads beyond
what a user paid for are kept in the shared cache; a re-search of the same
keyword+zip charges fresh for whatever the user receives this time.

## 1. Supabase — run the migration

Open Supabase SQL editor and run `sql/01_credits_migration.sql`. It does three
things:

1. `alter table user_credits alter column "Credits" type numeric(10,2)` — so
   fractional deductions (0.65) work. Existing balances (e.g. `99`) become `99.00`.
2. Creates `leadscrapper_delivered` — per-user "what they already paid for"
   ledger, so re-searches don't re-charge the same place_ids.
3. Creates `leadscrapper_searches` — one audit row per search.

## 2. Makerkit (app.pixnom.com) — add the deduct-leads endpoint

Copy `makerkit-api-credits/deduct-leads/route.ts` from this repo to:
```
/root/next-supabase-saas-kit-turbo-main/apps/web/app/api/supabase/credits/deduct-leads/route.ts
```
Then add to the Makerkit `.env`:
```
LEADSCRAPPER_SERVICE_TOKEN=<long random hex — generate once>
```
Rebuild + restart:
```bash
cd /root/next-supabase-saas-kit-turbo-main && pnpm build && pm2 restart makerkit
```

The existing `/api/supabase/credits/get` route (already deployed) handles
balance reads — we don't touch it.

## 3. Leadscrapper VPS — deploy the new + modified files

New files:
- `leadscrapper-credits-proxy.php`
- `lib/credits.php`

Modified files:
- `apify-proxy.php`
- `components/LeadSearch.jsx`  (rebuild the Vite frontend)

Add to leadscrapper `.env`:
```
LEADSCRAPPER_SERVICE_TOKEN=<same value you put in Makerkit .env>
MAKERKIT_ORIGIN=https://app.pixnom.com
```
(You can leave the existing `MAP2WEB_ORIGIN` as the fallback — the credit helper
reads both.)

Rebuild the frontend:
```bash
cd /var/www/leadscrapper.pixnom.com && npm run build
```

## 4. Smoke tests

From the leadscrapper VPS (or any machine that can hit it):

```bash
# Balance check — should return { email, balance, creditPerLead, leadsPerCredit }
curl 'https://leadscrapper.pixnom.com/apify-proxy.php?action=balance&email=YOU@EXAMPLE.COM'

# Search without email — should 401
curl -X POST 'https://leadscrapper.pixnom.com/apify-proxy.php?action=run' \
  -H 'Content-Type: application/json' \
  -d '{"searchStringsArray":["plumber"],"postalCode":"10001","countryCode":"us"}'

# Search with email — should 201 with the regular Apify shape (or _cached:true)
curl -X POST 'https://leadscrapper.pixnom.com/apify-proxy.php?action=run' \
  -H 'Content-Type: application/json' \
  -d '{"email":"YOU@EXAMPLE.COM","searchStringsArray":["plumber"],"postalCode":"10001","countryCode":"us"}'
```

After a successful search, check Supabase:
- `user_credits.Credits` for your email should have dropped by `delivered * 0.01`.
- `leadscrapper_searches` should have a new row.
- `leadscrapper_delivered` should have N new rows (one per delivered place_id).

## 5. Re-search behavior (the reserved-leads case)

User searches `plumber` + `90001`, gets 150 leads, but balance only allows 100.
- 100 placeIds inserted into `leadscrapper_delivered`.
- Pool of 150 kept in shared cache.
- User charged 1.00 credit.

User searches the same query later (after topping up):
- 100 placeIds match `leadscrapper_delivered` → re-served **for free** (they
  already paid).
- Remaining 50 placeIds (cap by current balance) get delivered + charged.

User searches `plumber` + a different zip:
- Different `cache_key`, so the prior 100 don't apply — fresh search, fresh charge.

## 6. Rolling back

The migration is additive. To roll back the SQL:
```sql
drop table if exists public.leadscrapper_searches;
drop table if exists public.leadscrapper_delivered;
-- The Credits column type change is safe to leave — numeric is a superset of int.
```
And revert the four code files (`apify-proxy.php`, `LeadSearch.jsx`, plus delete
`lib/credits.php` and `leadscrapper-credits-proxy.php`).
