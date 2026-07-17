# Agency Package — Task Tracker & Handoff Doc

**Created:** 2026-06-30
**Owner:** Claude (for sir / shreyashchandak)
**Purpose:** Self-contained spec + checklist for adding the **Agency $149.99 one-time** package. If this session runs out of credits, hand THIS file to another AI tool as context and it can continue from the first unchecked box.

---

## 0. TL;DR — what we're building

A new **$149.99 ONE-TIME** Stripe product called **Agency**. It is a *Website-Builder-only* tier:

- **Agency buyer** → **unlimited** website generation AND publishing (publishing is FREE for them).
- **Everyone else** (Starter/Pro/Enterprise/free) → can still use Website Builder, but **publishing charges 50 credits per site** (this charge currently does NOT exist — it's dead code that must be activated).
- **Stacks:** A user can own Agency *and* a credit plan at the same time → they get WB-unlimited (from Agency) **and** credits for the other modules (Map2Web / LeadScrapper / AI Receptionist). Agency is an **independent flag**, not an account-mode switch.
- The "who bought Agency" fact lives in a **NEW dedicated table** (NOT `plan_credits`, NOT a column on `user_credits`).

---

## 1. Decisions locked (sir confirmed 2026-06-30)

| # | Question | Decision |
|---|----------|----------|
| 1 | Billing type | **One-time** payment ($149.99), not recurring |
| 2 | What Agency unlocks | Website Builder **unlimited** generation + publishing (no credit charge) |
| 3 | Non-Agency users & WB | Can use WB, but **publishing costs 50 credits/site** |
| 4 | Stacking | Agency + credit plan = both work independently (WB unlimited + credits for other modules) |
| 5 | Storage | **New dedicated table** (separate from credit system) |
| 6 | Account switch on buy | NO mode-switch. Agency is just an added entitlement flag |

---

## 2. Key technical facts discovered (verified in code — DO NOT re-investigate, trust these)

- **SiteForge = the Website Builder.** Local path: `D:\SiteForge`. Prod static files at `/var/www/website-builder/` on VPS `74.208.208.186`. Served same-origin under `app.pixnom.com/website-builder/`.
- **SiteForge NOW HAS A BACKEND** at `D:\SiteForge\server\` (Express, PORT 3002). ⚠️ The old `INTEGRATION_NOTES.md` / `DEPLOYMENT_PLAN.md` claim "no backend, pure static" — **that is STALE. Ignore it.**
- **The 50-credit/site charge is DEAD CODE:**
  - `D:\SiteForge\server\credits.js` defines `CREDITS_PER_SITE = 50`, `getCredits/ensureUser/deductCredit/refundCredit` — but these handlers are **NOT mounted** in `server/index.js` and **NOT called** anywhere in the frontend. So today **everyone publishes for free.** Activating the 50-credit publish charge is part of THIS task.
- **Publish flow:** `D:\SiteForge\js\core.js` → `publishSite()` (~line 1025) → `POST /website-builder/api/publish` with body `{ html, slug }` → `server/index.js` route → `server/github.js publish()`. ⚠️ **The publish request does NOT currently send the user's account email.** Must add it.
- **Account email is available client-side** as `window.__AUTH_EMAIL__` (set in `D:\SiteForge\index.html` line ~21–23 from the `?email=` URL param that the Makerkit wrapper passes). `biz.email` is the *business form* email — NOT the account; do not use it for credit checks.
- **Shared credits table:** `user_credits` (columns `Email`, `Credits`, `UpdatedAt`). Same table Lead Scrapper uses. SiteForge talks to Supabase via REST (`server/supabase-rest.js`, service-role key in `server/.env`).
- **Dev-email bypass** exists in BOTH `server/credits.js` and `makerkit-siteforge/page.tsx`. Dev emails: `shreyashchandak.lx@gmail.com`, `shriganeshkolhe@gmail.com`. Normalize by stripping dots in local part. Dev emails must bypass the 50-credit charge too.
- **Makerkit billing app** lives on VPS at `/root/next-supabase-saas-kit-turbo-main/`. Billing config: `apps/web/config/billing.config.ts`. Webhook handler: `apps/web/app/api/billing/webhook/`. Env: `apps/web/.env.production.local`.
- **Supabase project ref:** `fnevhniqvchvxwkqzjzg`. SQL editor: https://supabase.com/dashboard/project/fnevhniqvchvxwkqzjzg/sql/new
- **Existing live products** (recurring monthly, for reference): Starter $29.99 `prod_Ua2dIrbgs4xJ6M`, Pro $59.99 `prod_Ua2eOokfWQDWLu`, Enterprise $99.99 `prod_Ua2eQGNKpKbreR`.
- **Why a new webhook path:** one-time payment fires `checkout.session.completed` with `mode: 'payment'` — it NEVER fires `invoice.paid`. The existing credit-grant webhook only handles subscription `invoice.paid`, so it will not grant Agency. A new branch in the webhook handler is required.

---

## 3. BLOCKING INPUT NEEDED FROM SIR  ✅ RECEIVED 2026-06-30

- [x] **Agency Product ID** = `prod_UneeCYsdMpvTo7`
- [x] **Agency Price ID** = `price_1To3LbEmMiDjqdjcHhLCcr8x` (one-time, $149.99)

> ⚠️ VERIFY these are **LIVE mode** IDs (not test). Test price IDs also look like `price_1...`. Confirm in Stripe dashboard top-right toggle = Live before going to prod.

> Until these two values exist, tasks in §5 (webhook + billing config) cannot be completed. Everything else (DB table, SiteForge gating) CAN be built in parallel without them.

Stripe form values sir should use: Name `Agency` (or `Pixnom Agency`), Pricing = **One-off**, Amount `149.99` USD, then add to **Settings → Billing → Customer portal** product list. ⚠️ Must be created in **LIVE mode** (Stripe products can't move between test/live).

---

## 4. Open sub-decision (resolve before coding §6)

- [ ] **How does SiteForge know if an email is an Agency buyer?** The SiteForge Express backend reads Supabase directly via REST. Simplest: it queries the new `agency_entitlements` table by email. Confirm this approach (vs. an internal API call to Makerkit). **Default plan: SiteForge backend reads the table directly via existing `supabase-rest.js`.**

---

## 5. Implementation tasks — Stripe / Makerkit side

> **DEPLOY FOLDER:** all VPS-side artifacts written to `D:\SiteForge\agency-deploy\` (sir uploads manually). See its README.md for apply order + exact VPS paths.
>
> **KEY DESIGN CHANGE (5.3):** Instead of editing the Stripe webhook TypeScript (which had 4 stacked bugs last time — see [[stripe-checkout-fix]]), Agency is granted by a **Postgres trigger on the `orders` table**, mirroring the existing credit-grant trigger on `subscriptions`. No webhook edit, no Makerkit rebuild for grants — pure SQL.

- [x] **5.1** Create `agency_entitlements` table (migration). DONE → `D:\SiteForge\migrations\20260630000000_agency_entitlements.sql` + `agency-deploy\01_agency_entitlements.sql`. Schema:
  ```sql
  create table if not exists public.agency_entitlements (
      id          uuid primary key default gen_random_uuid(),
      email       text not null,
      stripe_customer_id text,
      stripe_session_id  text unique,   -- idempotency: don't double-grant
      product_id  text,
      active      boolean not null default true,
      created_at  timestamptz not null default now()
  );
  create unique index if not exists idx_agency_entitlements_email on public.agency_entitlements (lower(email));
  ```
  Save to `D:\SiteForge\migrations\` (per sir — Agency SQL lives in SiteForge, NOT Lead Scrapper), then run in Supabase SQL editor.
- [x] **5.2** Agency one-time product block WRITTEN → `agency-deploy\03_billing_config_snippet.txt` (`paymentType: 'one-time'`, no interval, cost 149.99, live price, features). ⏳ sir pastes into VPS `billing.config.ts` + rebuilds.
- [x] **5.3** Grant logic WRITTEN as a trigger (NOT webhook edit) → `agency-deploy\02_agency_order_trigger.sql`. Fires on `orders` paid → upsert `agency_entitlements`, idempotent, does NOT touch `user_credits`. ⏳ sir runs SQL (after verifying orders schema).
- [ ] **5.4** Add Agency to Stripe **Customer Portal** product list (dashboard, LIVE). Note in snippet: one-time products may need a dedicated "buy" button vs portal switch — verify how billing page renders it. ⏳ sir / dashboard.
- [ ] **5.5** Rebuild + restart Makerkit on VPS (⏳ sir, after 5.2):
  ```bash
  ssh root@74.208.208.186
  source /root/.nvm/nvm.sh
  cd /root/next-supabase-saas-kit-turbo-main
  pnpm --filter web build
  pm2 restart makerkit --update-env
  ```

---

## 6. Implementation tasks — SiteForge / Website Builder side

- [x] **6.1** Mounted credit gating in `D:\SiteForge\server\index.js` POST /api/publish (folded the check into the publish route).
- [x] **6.2** Added `isAgency(email)` helper in `server/credits.js` (reads `agency_entitlements`, fail-closed on error). Also added `chargePublish`/`refundPublish` and exported `isDevEmail`, `CREDITS_PER_SITE`.
- [x] **6.3** Gated publishing: refactored `github.js` into pure `publishToGithub(html,slug)` + kept `publish` wrapper. Route does dev/Agency=free, else charge 50, refund if GitHub publish then fails or throws.
- [x] **6.4** `D:\SiteForge\js\core.js` `publishSite()` now sends `user_email: window.__AUTH_EMAIL__`.
- [x] **6.5** Confirmed: only publishing is charged; generation/preview left open. No code.
- [x] **6.6** Insufficient-credits message already surfaced by `publishSite()` via `data.error?.message`. Agency badge = nice-to-have, skipped for now.
- All server files pass `node -c` syntax check.
- [ ] **6.7** Deploy SiteForge changes to VPS: overwrite `index.html` + whole `js/` folder + `server/` files at `/var/www/website-builder/`, restart the node server (PORT 3002) however it's managed (pm2?). Verify the publish endpoint still responds.

---

## 7. Testing checklist

- [ ] **7.1** Non-Agency user with ≥50 credits publishes → 50 deducted, site goes live.
- [ ] **7.2** Non-Agency user with <50 credits → publish blocked with clear message, no GitHub push, no deduction.
- [ ] **7.3** Agency buyer publishes repeatedly → no credits deducted, all succeed (unlimited).
- [ ] **7.4** Dev email publishes → free, unaffected.
- [ ] **7.5** Buy Agency via Stripe test card `4242 4242 4242 4242` → `checkout.session.completed` fires → row appears in `agency_entitlements`, `user_credits` untouched.
- [ ] **7.6** Webhook idempotency: replay the same `checkout.session.completed` → only ONE entitlement row (the `stripe_session_id` unique constraint holds).
- [ ] **7.7** Stacking: user with Agency + a credit plan → WB publish free AND credits still spendable on Map2Web/LeadScrapper.
- [ ] **7.8** Generation/preview still free for everyone (no regression).
- [ ] **7.9** Billing UI shows Agency at $149.99 matching Stripe (no bait-and-switch).

---

## 8. Pricing card content (from sir's screenshot — for features list)

Agency — **$149.99 one-time**:
- Unlimited websites via Website Builder
- One-time payment - no monthly fees
- No coding required
- Free hosting included
- Free SSL certificate
- Drag & drop builder
- Mobile-responsive design
- SEO-optimized pages
- Custom domain support
- White-label reports
- Priority support

---

## 9. Files that will be touched (map)

| File | Side | Change |
|------|------|--------|
| `D:\SiteForge\migrations\<new>_agency_entitlements.sql` | DB | new table (§5.1) |
| `/root/.../apps/web/config/billing.config.ts` | Makerkit | add Agency one-time product (§5.2) |
| `/root/.../apps/web/app/api/billing/webhook/route.ts` | Makerkit | handle one-time checkout → entitlement (§5.3) |
| `D:\SiteForge\server\index.js` | SiteForge | mount credit/publish-gate routes (§6.1) |
| `D:\SiteForge\server\credits.js` | SiteForge | reuse/adjust deduct logic, add Agency check (§6.2–6.3) |
| `D:\SiteForge\server\github.js` | SiteForge | gate publish behind credit/Agency check (§6.3) |
| `D:\SiteForge\js\core.js` | SiteForge | send `user_email` in publish POST (§6.4) |

---

## 10. Progress log (append as work happens)

- 2026-06-30: Spec written, decisions locked, code investigated. Blocked on sir's Stripe Product/Price IDs (§3). Memory: `[[agency-package]]`.
- 2026-06-30: Stripe IDs received (prod_UneeCYsdMpvTo7 / price_1To3LbEmMiDjqdjcHhLCcr8x). All LOCAL code done + syntax-checked: SiteForge publish gate (server/index.js, credits.js, github.js), js/core.js email, migration. VPS artifacts written to `D:\SiteForge\agency-deploy\` for manual upload (chose trigger-on-orders over webhook edit to avoid the previously-buggy webhook). REMAINING = manual deploy + test (§6 / agency-deploy/README.md).
